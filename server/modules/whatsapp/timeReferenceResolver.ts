import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone, normalizeUserTimeZone, toLogicalDateInTimeZone } from "../../../shared/timeZone";
import { getUserOnboardingProfile } from "../onboarding/profileRead";

export type WhatsappMealTimeReference = {
  expression: string;
  mealLabel: string;
};

export type WhatsappResolvedTimeReference = {
  expression: string;
  dateKey: string;
  occurredAt: string;
  timezone: string;
  timezoneFallbackUsed: boolean;
  kind: "today" | "yesterday" | "tomorrow" | "day_before_yesterday" | "weekday" | "week_relative";
};

export type WhatsappTimeReferenceResolution = {
  text: string;
  changed: boolean;
  ambiguous: boolean;
  clarificationQuestion?: string;
  timeReference?: WhatsappResolvedTimeReference;
  mealReference?: WhatsappMealTimeReference;
  historyDetail: string;
};

type WeekdayReference = {
  expression: string;
  clarificationExpression: string;
  weekdayIndex: number;
  direction: "past" | "future" | null;
  kind: "weekday";
};

const WEEKDAY_ALIASES: Array<{ pattern: string; index: number; label: string }> = [
  { pattern: "segunda(?:\\s+feira)?", index: 0, label: "segunda" },
  { pattern: "terca(?:\\s+feira)?|terça(?:\\s+feira)?", index: 1, label: "terça" },
  { pattern: "quarta(?:\\s+feira)?", index: 2, label: "quarta" },
  { pattern: "quinta(?:\\s+feira)?", index: 3, label: "quinta" },
  { pattern: "sexta(?:\\s+feira)?", index: 4, label: "sexta" },
  { pattern: "sabado|sábado", index: 5, label: "sábado" },
  { pattern: "domingo", index: 6, label: "domingo" },
];

const MEAL_LABELS: Array<{ normalizedPattern: RegExp; rawPattern: RegExp; label: string }> = [
  { normalizedPattern: /\bcafe\s*(?:da\s*)?manha\b/u, rawPattern: /\bcaf[eé]\s*(?:da\s*)?manh[aã]\b/iu, label: "Café da manhã" },
  { normalizedPattern: /\balmoco\b/u, rawPattern: /\b(?:almoco|almo[cç]o)\b/iu, label: "Almoço" },
  { normalizedPattern: /\bjantar\b/u, rawPattern: /\bjantar\b/iu, label: "Jantar" },
  { normalizedPattern: /\bceia\b/u, rawPattern: /\bceia\b/iu, label: "Ceia" },
  { normalizedPattern: /\blanche\b/u, rawPattern: /\blanche\b/iu, label: "Lanche" },
  { normalizedPattern: /\bpre\s*treino\b/u, rawPattern: /\bpr[eé]\s*treino\b/iu, label: "Pré-treino" },
  { normalizedPattern: /\bpos\s*treino\b/u, rawPattern: /\bp[oó]s\s*treino\b/iu, label: "Pós-treino" },
];

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildOccurredAt(dateKey: string) {
  return `${dateKey}T12:00:00.000Z`;
}

function getWeekdayIndex(logicalDate: Date) {
  return (logicalDate.getUTCDay() + 6) % 7;
}

function getWeekdayDate(referenceDate: Date, targetIndex: number, direction: "past" | "future") {
  const currentIndex = getWeekdayIndex(referenceDate);
  if (direction === "past") {
    const diff = (currentIndex - targetIndex + 7) % 7 || 7;
    return addDays(referenceDate, -diff);
  }
  const diff = (targetIndex - currentIndex + 7) % 7 || 7;
  return addDays(referenceDate, diff);
}

function detectMealReference(text: string, normalized: string): WhatsappMealTimeReference | undefined {
  for (const meal of MEAL_LABELS) {
    const rawMatch = meal.rawPattern.exec(text);
    if (rawMatch?.[0]) {
      return { expression: rawMatch[0], mealLabel: meal.label };
    }

    const normalizedMatch = meal.normalizedPattern.exec(normalized);
    if (normalizedMatch?.[0]) {
      return { expression: normalizedMatch[0], mealLabel: meal.label };
    }
  }
  return undefined;
}

function detectRelativeReference(normalized: string) {
  if (/\banteontem\b/.test(normalized)) return { expression: "anteontem", offsetDays: -2, kind: "day_before_yesterday" as const };
  if (/\bontem\b/.test(normalized)) return { expression: "ontem", offsetDays: -1, kind: "yesterday" as const };
  if (/\bamanha\b/.test(normalized)) return { expression: "amanhã", offsetDays: 1, kind: "tomorrow" as const };
  if (/\bhoje\b/.test(normalized)) return { expression: "hoje", offsetDays: 0, kind: "today" as const };
  return null;
}

function detectWeekdayReference(normalized: string): WeekdayReference | null {
  for (const weekday of WEEKDAY_ALIASES) {
    const pastMatch = new RegExp(`\\b(${weekday.pattern})\\s+passad[ao]\\b`).exec(normalized);
    if (pastMatch) {
      return {
        expression: `${pastMatch[1]} passado`,
        clarificationExpression: `${weekday.label} passado`,
        weekdayIndex: weekday.index,
        direction: "past",
        kind: "weekday",
      };
    }

    const futureMatch = new RegExp(`\\b(?:proxim[ao]|pr[oó]xim[ao])\\s+(${weekday.pattern})\\b`).exec(normalized);
    if (futureMatch) {
      return {
        expression: `proximo ${futureMatch[1]}`,
        clarificationExpression: `próximo ${weekday.label}`,
        weekdayIndex: weekday.index,
        direction: "future",
        kind: "weekday",
      };
    }

    const ambiguousMatch = new RegExp(`\\b(${weekday.pattern})\\b`).exec(normalized);
    if (ambiguousMatch) {
      return {
        expression: ambiguousMatch[1],
        clarificationExpression: weekday.label,
        weekdayIndex: weekday.index,
        direction: null,
        kind: "weekday",
      };
    }
  }
  return null;
}

function stripTemporalMarkers(text: string) {
  return text
    .replace(/\b(?:de\s+)?(?:hoje|ontem|amanh[aã]|anteontem)\b/giu, " ")
    .replace(/\b(?:da\s+)?semana\s+passada\b/giu, " ")
    .replace(/\b(?:pr[oó]xim[ao]\s+)?(?:segunda(?:\s+feira)?|ter[cç]a(?:\s+feira)?|quarta(?:\s+feira)?|quinta(?:\s+feira)?|sexta(?:\s+feira)?|s[aá]bado|domingo)(?:\s+passad[ao])?\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildWhatsappTimeReferenceClarification(resolution: WhatsappTimeReferenceResolution) {
  return {
    handled: true,
    action: "time_reference_clarification_needed",
    reply: resolution.clarificationQuestion ?? "Preciso que você esclareça a data antes de alterar qualquer registro.",
    eventType: "whatsapp.time_reference.clarification_needed",
    detail: resolution.historyDetail,
    data: {
      timeReferenceAmbiguous: true,
      mealLabel: resolution.mealReference?.mealLabel ?? null,
    },
  };
}

export function resolveWhatsappTimeReferencesForText(input: {
  text: string;
  receivedAt?: Date;
  timezone?: string | null;
  timezoneFallbackUsed?: boolean;
}): WhatsappTimeReferenceResolution {
  const originalText = input.text.trim();
  const timezone = normalizeUserTimeZone(input.timezone);
  const timezoneFallbackUsed = input.timezoneFallbackUsed ?? !input.timezone;
  const receivedAt = input.receivedAt ?? new Date();
  const logicalToday = toLogicalDateInTimeZone(receivedAt, timezone);
  const normalized = normalizeText(originalText);
  const mealReference = detectMealReference(originalText, normalized);
  const relative = detectRelativeReference(normalized);
  const weekday = detectWeekdayReference(normalized);

  if (weekday && weekday.direction === null) {
    const clarificationExpression = weekday.clarificationExpression;
    return {
      text: originalText,
      changed: false,
      ambiguous: true,
      mealReference,
      clarificationQuestion: `Quando você diz ${clarificationExpression}, quer dizer ${clarificationExpression} passado ou próximo ${clarificationExpression}?`,
      historyDetail: `Referência temporal ambígua "${weekday.expression}" detectada com fuso ${timezone}.`,
    };
  }

  let resolvedDate = logicalToday;
  let expression: string | null = null;
  let kind: WhatsappResolvedTimeReference["kind"] = "today";

  if (/\bsemana passada\b/.test(normalized)) {
    resolvedDate = addDays(logicalToday, -7);
    expression = "semana passada";
    kind = "week_relative";
  }

  if (weekday?.direction) {
    resolvedDate = getWeekdayDate(logicalToday, weekday.weekdayIndex, weekday.direction);
    expression = weekday.expression;
    kind = weekday.kind;
  }

  if (relative) {
    resolvedDate = addDays(logicalToday, relative.offsetDays);
    expression = relative.expression;
    kind = relative.kind;
  }

  if (!expression && !mealReference) {
    return {
      text: originalText,
      changed: false,
      ambiguous: false,
      historyDetail: `Nenhuma referência temporal ou refeição relativa detectada com fuso ${timezone}.`,
    };
  }

  const dateKey = getDateKeyInTimeZone(resolvedDate, DEFAULT_APP_TIME_ZONE);
  const timeReference = expression ? {
    expression,
    dateKey,
    occurredAt: buildOccurredAt(dateKey),
    timezone,
    timezoneFallbackUsed,
    kind,
  } : undefined;

  const stripped = expression ? stripTemporalMarkers(originalText) : originalText;
  return {
    text: stripped || originalText,
    changed: stripped !== originalText,
    ambiguous: false,
    timeReference,
    mealReference,
    historyDetail: expression
      ? `Referência temporal "${expression}" resolvida para ${dateKey} usando fuso ${timezone}${timezoneFallbackUsed ? " com fallback" : ""}.`
      : `Referência de refeição "${mealReference?.expression}" detectada usando fuso ${timezone}.`,
  };
}

export async function resolveWhatsappTimeReferences(userId: number, input: { text: string; receivedAt?: Date }) {
  const profile = await getUserOnboardingProfile(userId);
  return resolveWhatsappTimeReferencesForText({
    text: input.text,
    receivedAt: input.receivedAt,
    timezone: profile?.timezone,
    timezoneFallbackUsed: !profile?.timezone,
  });
}
