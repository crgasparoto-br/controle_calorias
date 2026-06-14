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

const WEEKDAY_INDEX: Record<string, number> = {
  segunda: 0,
  "segunda feira": 0,
  terca: 1,
  "terca feira": 1,
  terça: 1,
  "terça feira": 1,
  quarta: 2,
  "quarta feira": 2,
  quinta: 3,
  "quinta feira": 3,
  sexta: 4,
  "sexta feira": 4,
  sabado: 5,
  sábado: 5,
  domingo: 6,
};

const MEAL_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcaf[eé]\s*(?:da\s*)?manh[aã]\b/iu, label: "Café da manhã" },
  { pattern: /\b(?:almoco|almo[cç]o)\b/iu, label: "Almoço" },
  { pattern: /\bjantar\b/iu, label: "Jantar" },
  { pattern: /\bceia\b/iu, label: "Ceia" },
  { pattern: /\blanche\b/iu, label: "Lanche" },
  { pattern: /\bpr[eé]\s*treino\b/iu, label: "Pré-treino" },
  { pattern: /\bp[oó]s\s*treino\b/iu, label: "Pós-treino" },
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

function detectMealReference(text: string): WhatsappMealTimeReference | undefined {
  for (const meal of MEAL_LABELS) {
    const match = meal.pattern.exec(text);
    if (match?.[0]) {
      return { expression: match[0], mealLabel: meal.label };
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

function detectWeekdayReference(normalized: string) {
  for (const [weekday, index] of Object.entries(WEEKDAY_INDEX)) {
    const escaped = weekday.replace(/ /g, "\\s+");
    if (new RegExp(`\\b(?:sabado|sábado|domingo|segunda|segunda\\s+feira|terca|terça|terca\\s+feira|terça\\s+feira|quarta|quarta\\s+feira|quinta|quinta\\s+feira|sexta|sexta\\s+feira)\\s+passad[ao]\\b`).test(normalized)) {
      const match = normalized.match(/\b(sabado|sábado|domingo|segunda(?:\s+feira)?|terca(?:\s+feira)?|terça(?:\s+feira)?|quarta(?:\s+feira)?|quinta(?:\s+feira)?|sexta(?:\s+feira)?)\s+passad[ao]\b/);
      if (!match) return null;
      const target = WEEKDAY_INDEX[match[1]];
      return target == null ? null : { expression: `${match[1]} passado`, weekdayIndex: target, direction: "past" as const, kind: "weekday" as const };
    }
    if (new RegExp(`\\b(?:proxim[ao]|pr[oó]xim[ao])\\s+${escaped}\\b`).test(normalized)) {
      return { expression: `próximo ${weekday}`, weekdayIndex: index, direction: "future" as const, kind: "weekday" as const };
    }
    if (new RegExp(`\\b${escaped}\\b`).test(normalized)) {
      return { expression: weekday, weekdayIndex: index, direction: null, kind: "weekday" as const };
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
  const mealReference = detectMealReference(originalText);
  const relative = detectRelativeReference(normalized);
  const weekday = detectWeekdayReference(normalized);

  if (weekday && weekday.direction === null) {
    return {
      text: originalText,
      changed: false,
      ambiguous: true,
      mealReference,
      clarificationQuestion: `Quando você diz ${weekday.expression}, quer dizer ${weekday.expression} passado ou próximo ${weekday.expression}?`,
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
