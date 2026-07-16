import {
  DEFAULT_APP_TIME_ZONE,
  addCalendarDays,
  addCalendarMonths,
  getDateKeyInTimeZone,
  getDateTimePartsInTimeZone,
  getUtcRangeForLocalDate,
  getUtcRangeForLocalDateRange,
  getWeekDateKeys,
  zonedDateTimeLocalToDate,
  zonedDateTimePartsToDate,
} from "../../../../shared/timeZone";
import type { PeriodRange, ZonedParts } from "./types";
import { normalizeIntentText } from "./textUtils";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatReplyDateTime(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

export function formatReplyDate(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
}

export function getZonedParts(date: Date, timeZone = DEFAULT_APP_TIME_ZONE): ZonedParts {
  return getDateTimePartsInTimeZone(date, timeZone);
}

export function makeDateInTimeZone(parts: ZonedParts, timeZone = DEFAULT_APP_TIME_ZONE) {
  return zonedDateTimePartsToDate(parts, timeZone, { normalizeOverflow: true });
}

export function addDaysToZonedDate(parts: ZonedParts, days: number): ZonedParts {
  const dateKey = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const shifted = addCalendarDays(dateKey, days);
  const [year, month, day] = shifted.split("-").map(Number);
  return { year, month, day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

export function resolveRelativeOccurredAt(text: string, receivedAt: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const normalized = normalizeIntentText(text);
  const referenceParts = getZonedParts(receivedAt, timeZone);
  if (/\banteontem\b/.test(normalized)) return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -2), timeZone);
  if (/\bontem\b/.test(normalized)) return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -1), timeZone);
  if (/\bamanha\b/.test(normalized)) return makeDateInTimeZone(addDaysToZonedDate(referenceParts, 1), timeZone);
  return receivedAt;
}

export function startOfZonedDay(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  return getUtcRangeForLocalDate(getDateKeyInTimeZone(date, timeZone), timeZone).startAt;
}

export function endOfZonedDay(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const { endAt } = getUtcRangeForLocalDate(getDateKeyInTimeZone(date, timeZone), timeZone);
  return new Date(endAt.getTime() - 1);
}

export function startOfZonedWeek(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const [startDate] = getWeekDateKeys(date, timeZone);
  return getUtcRangeForLocalDate(startDate, timeZone).startAt;
}

function endOfZonedWeek(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const dates = getWeekDateKeys(date, timeZone);
  return new Date(getUtcRangeForLocalDate(dates[dates.length - 1], timeZone).endAt.getTime() - 1);
}

export function startOfZonedMonth(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const monthStart = `${getDateKeyInTimeZone(date, timeZone).slice(0, 7)}-01`;
  return getUtcRangeForLocalDate(monthStart, timeZone).startAt;
}

export function endOfZonedMonth(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const currentMonthStart = `${getDateKeyInTimeZone(date, timeZone).slice(0, 7)}-01`;
  const nextMonthStart = addCalendarMonths(currentMonthStart, 1);
  return new Date(zonedDateTimeLocalToDate(`${nextMonthStart}T00:00:00`, timeZone).getTime() - 1);
}

function buildDateFromMatch(
  day: string,
  month: string,
  year: string | undefined,
  reference: Date,
  timeZone: string,
  endOfDay = false,
) {
  const referenceParts = getZonedParts(reference, timeZone);
  const parsedYear = year ? Number(year.length === 2 ? `20${year}` : year) : referenceParts.year;
  return makeDateInTimeZone({
    year: parsedYear,
    month: Number(month),
    day: Number(day),
    hour: endOfDay ? 23 : 0,
    minute: endOfDay ? 59 : 0,
    second: endOfDay ? 59 : 0,
  }, timeZone);
}

function formatPeriodRangeLabel(start: Date, end: Date, timeZone: string) {
  return `${formatReplyDate(start, timeZone)} a ${formatReplyDate(end, timeZone)}`;
}

function parseExplicitPeriodRange(normalized: string, receivedAt: Date, timeZone: string): PeriodRange | null {
  const match = normalized.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\s*(?:a|ate)\s*(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  if (!match) return null;

  const start = buildDateFromMatch(match[1], match[2], match[3], receivedAt, timeZone);
  const end = buildDateFromMatch(match[4], match[5], match[6] ?? match[3], receivedAt, timeZone, true);
  if (start.getTime() > end.getTime()) return null;
  return { label: formatPeriodRangeLabel(start, end, timeZone), start, end };
}

function buildPeriodRange(label: string, start: Date, end: Date): PeriodRange {
  return { label, start, end };
}

function parseRelativeWeekPeriod(normalized: string, receivedAt: Date, timeZone: string) {
  if (!/\bsemana\b/.test(normalized)) return null;
  const weekDates = getWeekDateKeys(receivedAt, timeZone);
  if (/\b(passad[ao]s?|anterior(?:es)?)\b/.test(normalized)) {
    const startDate = addCalendarDays(weekDates[0], -7);
    const endDate = addCalendarDays(startDate, 6);
    const range = getUtcRangeForLocalDateRange(startDate, addCalendarDays(endDate, 1), timeZone);
    const end = new Date(range.endAt.getTime() - 1);
    return buildPeriodRange(`semana passada (${formatPeriodRangeLabel(range.startAt, end, timeZone)})`, range.startAt, end);
  }
  return buildPeriodRange("semana", startOfZonedWeek(receivedAt, timeZone), endOfZonedWeek(receivedAt, timeZone));
}

function parseRelativeMonthPeriod(normalized: string, receivedAt: Date, timeZone: string) {
  if (!/\bmes\b/.test(normalized)) return null;
  const currentMonthStart = startOfZonedMonth(receivedAt, timeZone);
  if (/\b(passad[ao]s?|anterior(?:es)?)\b/.test(normalized)) {
    const currentParts = getZonedParts(currentMonthStart, timeZone);
    const start = makeDateInTimeZone({ ...currentParts, month: currentParts.month - 1, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
    const end = endOfZonedMonth(start, timeZone);
    return buildPeriodRange(`mês passado (${formatPeriodRangeLabel(start, end, timeZone)})`, start, end);
  }
  return buildPeriodRange("mês", currentMonthStart, endOfZonedMonth(receivedAt, timeZone));
}

export function parseReportPeriod(text: string, receivedAt: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const normalized = normalizeIntentText(text);
  if (!/\b(resumo|relatorio|balanco)\b/.test(normalized)) return null;

  const explicitRange = parseExplicitPeriodRange(normalized, receivedAt, timeZone);
  if (explicitRange) return explicitRange;
  if (/\bhoje\b/.test(normalized)) return buildPeriodRange("hoje", startOfZonedDay(receivedAt, timeZone), endOfZonedDay(receivedAt, timeZone));
  if (/\bontem\b/.test(normalized)) {
    const yesterday = makeDateInTimeZone(addDaysToZonedDate(getZonedParts(receivedAt, timeZone), -1), timeZone);
    return buildPeriodRange("ontem", startOfZonedDay(yesterday, timeZone), endOfZonedDay(yesterday, timeZone));
  }
  if (/\b(ultimos 7 dias|ultimos sete dias)\b/.test(normalized)) {
    const startKey = addCalendarDays(getDateKeyInTimeZone(receivedAt, timeZone), -6);
    const start = getUtcRangeForLocalDate(startKey, timeZone).startAt;
    return buildPeriodRange("últimos 7 dias", start, endOfZonedDay(receivedAt, timeZone));
  }

  return parseRelativeWeekPeriod(normalized, receivedAt, timeZone)
    ?? parseRelativeMonthPeriod(normalized, receivedAt, timeZone)
    ?? { kind: "clarification" as const };
}

export function isMealInsidePeriod(meal: { occurredAt: number | string | Date }, period: PeriodRange) {
  const occurredAt = new Date(meal.occurredAt).getTime();
  return occurredAt >= period.start.getTime() && occurredAt <= period.end.getTime();
}
