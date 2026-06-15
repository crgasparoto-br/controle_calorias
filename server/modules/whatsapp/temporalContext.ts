type WhatsappTemporalDateKind = "today" | "yesterday" | "tomorrow" | "day_before_yesterday" | "weekday";

type WhatsappTemporalContext = {
  temporalExpression: string;
  resolvedDate: string;
  mealSlot: string | null;
  userTimezone: string;
  timezoneSource: "configured" | "fallback";
  localReferenceDate: string;
  dateKind: WhatsappTemporalDateKind;
};

type WhatsappTemporalClarification = {
  handled: true;
  action: "temporal_context_clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
};

export type WhatsappTemporalResolution = {
  context: WhatsappTemporalContext | null;
  clarification: WhatsappTemporalClarification | null;
};

type WhatsappTemporalInput = {
  text?: string | null;
  receivedAt: Date;
  userTimezone?: string | null;
};

const DEFAULT_FALLBACK_TIMEZONE = "America/Sao_Paulo";

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  "segunda feira": 1,
  terca: 2,
  "terca feira": 2,
  terça: 2,
  "terça feira": 2,
  quarta: 3,
  "quarta feira": 3,
  quinta: 4,
  "quinta feira": 4,
  sexta: 5,
  "sexta feira": 5,
  sabado: 6,
  sábado: 6,
};

const MEAL_SLOT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:cafe da manha|café da manhã|cafe|café)\b/i, "cafe_da_manha"],
  [/\b(?:almoco|almoço)\b/i, "almoco"],
  [/\bjantar\b/i, "jantar"],
  [/\bceia\b/i, "ceia"],
  [/\blanche\b/i, "lanche"],
  [/\bpre treino|pré treino|pre\-treino|pré\-treino\b/i, "pre_treino"],
  [/\bpos treino|pós treino|pos\-treino|pós\-treino\b/i, "pos_treino"],
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

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveTimezone(userTimezone?: string | null) {
  const configured = userTimezone?.trim();
  if (configured && isValidTimezone(configured)) {
    return { userTimezone: configured, timezoneSource: "configured" as const };
  }
  return { userTimezone: DEFAULT_FALLBACK_TIMEZONE, timezoneSource: "fallback" as const };
}

function getLocalDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const weekdayText = get("weekday").toLowerCase();
  const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekdayText.slice(0, 3));
  return { year, month, day, weekday };
}

function toIsoDate(parts: { year: number; month: number; day: number }) {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function addLocalDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function getIsoWeekday(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function resolveWeekdayDate(referenceDate: string, targetWeekday: number, direction: "past" | "future") {
  const currentWeekday = getIsoWeekday(referenceDate);
  if (direction === "past") {
    const delta = (currentWeekday - targetWeekday + 7) % 7 || 7;
    return addLocalDays(referenceDate, -delta);
  }
  const delta = (targetWeekday - currentWeekday + 7) % 7 || 7;
  return addLocalDays(referenceDate, delta);
}

function detectMealSlot(text: string) {
  for (const [pattern, slot] of MEAL_SLOT_PATTERNS) {
    if (pattern.test(text)) return slot;
  }
  return null;
}

function weekdayFromText(normalized: string) {
  return Object.entries(WEEKDAYS)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([label]) => new RegExp(`\\b${label}\\b`).test(normalized)) ?? null;
}

function buildClarification(input: {
  text: string;
  userTimezone: string;
  timezoneSource: "configured" | "fallback";
  localReferenceDate: string;
  reason: string;
}) {
  return {
    handled: true,
    action: "temporal_context_clarification_needed" as const,
    reply: "Preciso de uma data mais específica para continuar com segurança. Diga, por exemplo, 'sábado passado', 'próximo sábado', 'ontem' ou uma data completa.",
    eventType: "whatsapp.time.temporal_clarification_needed",
    detail: `Referencia temporal ambigua: ${input.reason}.`,
    data: {
      temporalExpression: input.text,
      userTimezone: input.userTimezone,
      timezoneSource: input.timezoneSource,
      localReferenceDate: input.localReferenceDate,
      ambiguityReason: input.reason,
    },
  };
}

export function resolveWhatsappTemporalContext(input: WhatsappTemporalInput): WhatsappTemporalResolution {
  const text = input.text?.trim();
  if (!text) return { context: null, clarification: null };

  const normalized = normalizeText(text);
  const { userTimezone, timezoneSource } = resolveTimezone(input.userTimezone);
  const localParts = getLocalDateParts(input.receivedAt, userTimezone);
  const localReferenceDate = toIsoDate(localParts);
  const mealSlot = detectMealSlot(text);

  const buildContext = (temporalExpression: string, resolvedDate: string, dateKind: WhatsappTemporalDateKind): WhatsappTemporalContext => ({
    temporalExpression,
    resolvedDate,
    mealSlot,
    userTimezone,
    timezoneSource,
    localReferenceDate,
    dateKind,
  });

  if (/\banteontem\b/.test(normalized)) {
    return { context: buildContext("anteontem", addLocalDays(localReferenceDate, -2), "day_before_yesterday"), clarification: null };
  }
  if (/\bontem\b/.test(normalized)) {
    return { context: buildContext("ontem", addLocalDays(localReferenceDate, -1), "yesterday"), clarification: null };
  }
  if (/\bamanha\b/.test(normalized)) {
    return { context: buildContext("amanha", addLocalDays(localReferenceDate, 1), "tomorrow"), clarification: null };
  }
  if (/\bhoje\b/.test(normalized)) {
    return { context: buildContext("hoje", localReferenceDate, "today"), clarification: null };
  }

  if (/\bsemana passada\b/.test(normalized)) {
    return {
      context: null,
      clarification: buildClarification({
        text: "semana passada",
        userTimezone,
        timezoneSource,
        localReferenceDate,
        reason: "semana passada sem dia especifico",
      }),
    };
  }

  const weekdayMatch = weekdayFromText(normalized);
  if (weekdayMatch) {
    const [weekdayLabel, weekday] = weekdayMatch;
    if (new RegExp(`\\b(?:sabado|sábado|domingo|segunda(?: feira)?|terca(?: feira)?|terça(?: feira)?|quarta(?: feira)?|quinta(?: feira)?|sexta(?: feira)?) passado\\b`).test(normalized)) {
      return { context: buildContext(`${weekdayLabel} passado`, resolveWeekdayDate(localReferenceDate, weekday, "past"), "weekday"), clarification: null };
    }
    if (new RegExp(`\\b(?:proximo|próximo) (?:sabado|sábado|domingo|segunda(?: feira)?|terca(?: feira)?|terça(?: feira)?|quarta(?: feira)?|quinta(?: feira)?|sexta(?: feira)?)\\b`).test(normalized)) {
      return { context: buildContext(`proximo ${weekdayLabel}`, resolveWeekdayDate(localReferenceDate, weekday, "future"), "weekday"), clarification: null };
    }
    return {
      context: null,
      clarification: buildClarification({
        text: weekdayLabel,
        userTimezone,
        timezoneSource,
        localReferenceDate,
        reason: "dia da semana sem passado ou proximo",
      }),
    };
  }

  if (mealSlot) {
    return { context: buildContext(mealSlot, localReferenceDate, "today"), clarification: null };
  }

  return { context: null, clarification: null };
}
