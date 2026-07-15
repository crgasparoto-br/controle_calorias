import type { PeriodRange, ZonedParts } from "./types";
import { normalizeIntentText } from "./textUtils";

export const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

export function formatReplyDateTime(date: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

export function formatReplyDate(date: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
}

export function getZonedParts(date: Date, timeZone = SAO_PAULO_TIME_ZONE): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function makeDateInTimeZone(parts: ZonedParts, timeZone = SAO_PAULO_TIME_ZONE) {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const actualParts = getZonedParts(utcGuess, timeZone);
  const desiredUtcMinutes = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 60_000;
  const actualUtcMinutes = Date.UTC(
    actualParts.year,
    actualParts.month - 1,
    actualParts.day,
    actualParts.hour,
    actualParts.minute,
    actualParts.second,
  ) / 60_000;
  const offsetMinutes = actualUtcMinutes - desiredUtcMinutes;
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

export function addDaysToZonedDate(parts: ZonedParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function resolveRelativeOccurredAt(text: string, receivedAt: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  const normalized = normalizeIntentText(text);
  const referenceParts = getZonedParts(receivedAt, timeZone);
  if (/\banteontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -2), timeZone);
  }
  if (/\bontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -1), timeZone);
  }
  if (/\bamanha\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, 1), timeZone);
  }
  return receivedAt;
}

export function startOfZonedDay(date: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  const parts = getZonedParts(date, timeZone);
  return makeDateInTimeZone({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function endOfZonedDay(date: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  const parts = getZonedParts(date, timeZone);
  return makeDateInTimeZone({ ...parts, hour: 23, minute: 59, second: 59 }, timeZone);
}

export function startOfZonedWeek(date: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  const parts = getZonedParts(date, timeZone);
  const weekday = (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7;
  return makeDateInTimeZone({ ...addDaysToZonedDate({ ...parts, hour: 0, minute: 0, second: 0 }, -weekday), hour: 0, minute: 0, second: 0 }, timeZone);
}

function endOfZonedWeek(date: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  const start = startOfZonedWeek(date, timeZone);
  return endOfZonedDay(makeDateInTimeZone(addDaysToZonedDate(getZonedParts(start, timeZone), 6), timeZone), timeZone);
}

export function startOfZonedMonth(date: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  const parts = getZonedParts(date, timeZone);
  return makeDateInTimeZone({ ...parts, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function endOfZonedMonth(date: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  const parts = getZonedParts(date, timeZone);
  return makeDateInTimeZone({ ...parts, month: parts.month + 1, day: 0, hour: 23, minute: 59, second: 59 }, timeZone);
}

function buildDateFromMatch(day: string, month: string, year: string | undefined, reference: Date, endOfDay = false) {
  const referenceParts = getZonedParts(reference);
  const parsedYear = year
    ? Number(year.length === 2 ? `20${year}` : year)
    : referenceParts.year;
  return makeDateInTimeZone({
    year: parsedYear,
    month: Number(month),
    day: Number(day),
    hour: endOfDay ? 23 : 0,
    minute: endOfDay ? 59 : 0,
    second: endOfDay ? 59 : 0,
  });
}

function formatPeriodRangeLabel(start: Date, end: Date) {
  return `${formatReplyDate(start)} a ${formatReplyDate(end)}`;
}

function parseExplicitPeriodRange(normalized: string, receivedAt: Date): PeriodRange | null {
  const match = normalized.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\s*(?:a|ate)\s*(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  if (!match) {
    return null;
  }

  const start = buildDateFromMatch(match[1], match[2], match[3], receivedAt);
  const end = buildDateFromMatch(match[4], match[5], match[6] ?? match[3], receivedAt, true);
  if (start.getTime() > end.getTime()) {
    return null;
  }

  return {
    label: formatPeriodRangeLabel(start, end),
    start,
    end,
  };
}

function buildPeriodRange(label: string, start: Date, end: Date): PeriodRange {
  return {
    label,
    start,
    end,
  };
}

function parseRelativeWeekPeriod(normalized: string, receivedAt: Date, timeZone: string) {
  if (!/\bsemana\b/.test(normalized)) {
    return null;
  }

  const currentWeekStart = startOfZonedWeek(receivedAt, timeZone);
  if (/\b(passad[ao]s?|anterior(?:es)?)\b/.test(normalized)) {
    const start = makeDateInTimeZone(addDaysToZonedDate(getZonedParts(currentWeekStart, timeZone), -7), timeZone);
    const end = endOfZonedDay(makeDateInTimeZone(addDaysToZonedDate(getZonedParts(start, timeZone), 6), timeZone), timeZone);
    return buildPeriodRange(`semana passada (${formatPeriodRangeLabel(start, end)})`, start, end);
  }

  const end = endOfZonedWeek(receivedAt, timeZone);
  return buildPeriodRange("semana", currentWeekStart, end);
}

function parseRelativeMonthPeriod(normalized: string, receivedAt: Date, timeZone: string) {
  if (!/\bmes\b/.test(normalized)) {
    return null;
  }

  const currentMonthStart = startOfZonedMonth(receivedAt, timeZone);
  if (/\b(passad[ao]s?|anterior(?:es)?)\b/.test(normalized)) {
    const currentParts = getZonedParts(currentMonthStart, timeZone);
    const start = makeDateInTimeZone({ ...currentParts, month: currentParts.month - 1, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
    const end = endOfZonedMonth(start, timeZone);
    return buildPeriodRange(`mês passado (${formatPeriodRangeLabel(start, end)})`, start, end);
  }

  return buildPeriodRange("mês", currentMonthStart, endOfZonedMonth(receivedAt, timeZone));
}

export function parseReportPeriod(text: string, receivedAt: Date, timeZone = SAO_PAULO_TIME_ZONE) {
  const normalized = normalizeIntentText(text);
  if (!/\b(resumo|relatorio|balanco)\b/.test(normalized)) {
    return null;
  }

  const explicitRange = parseExplicitPeriodRange(normalized, receivedAt);
  if (explicitRange) {
    return explicitRange;
  }

  if (/\bhoje\b/.test(normalized)) {
    return buildPeriodRange("hoje", startOfZonedDay(receivedAt, timeZone), endOfZonedDay(receivedAt, timeZone));
  }

  if (/\bontem\b/.test(normalized)) {
    const yesterday = makeDateInTimeZone(addDaysToZonedDate(getZonedParts(receivedAt, timeZone), -1), timeZone);
    return buildPeriodRange("ontem", startOfZonedDay(yesterday, timeZone), endOfZonedDay(yesterday, timeZone));
  }

  if (/\b(ultimos 7 dias|ultimos sete dias)\b/.test(normalized)) {
    const start = startOfZonedDay(makeDateInTimeZone(addDaysToZonedDate(getZonedParts(receivedAt, timeZone), -6), timeZone), timeZone);
    return buildPeriodRange("últimos 7 dias", start, endOfZonedDay(receivedAt, timeZone));
  }

  const weekPeriod = parseRelativeWeekPeriod(normalized, receivedAt, timeZone);
  if (weekPeriod) {
    return weekPeriod;
  }

  const monthPeriod = parseRelativeMonthPeriod(normalized, receivedAt, timeZone);
  if (monthPeriod) {
    return monthPeriod;
  }

  return { kind: "clarification" as const };
}

export function isMealInsidePeriod(meal: { occurredAt: number | string | Date }, period: PeriodRange) {
  const occurredAt = new Date(meal.occurredAt).getTime();
  return occurredAt >= period.start.getTime() && occurredAt <= period.end.getTime();
}
