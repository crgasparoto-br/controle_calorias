import {
  addCalendarDays,
  getDateKeyInTimeZone,
  getUtcRangeForLocalDate,
} from "../../../shared/timeZone";

export function getDateKeyInZone(date: Date, timeZone: string) {
  return getDateKeyInTimeZone(date, timeZone);
}

export function startOfCalendarDayInZone(date: Date, timeZone: string) {
  const dateKey = getDateKeyInTimeZone(date, timeZone);
  return getUtcRangeForLocalDate(dateKey, timeZone).startAt;
}

export function getNoFoodRecordsWindow(now: Date, timeZone: string) {
  const currentDateKey = getDateKeyInTimeZone(now, timeZone);
  const startDateKey = addCalendarDays(currentDateKey, -3);
  return {
    start: getUtcRangeForLocalDate(startDateKey, timeZone).startAt,
    end: now,
  };
}

export function buildOperationalAlertDedupeKey(
  authorizationId: string,
  type: string,
  originOrPeriod: string
) {
  return `${authorizationId}:${type}:${originOrPeriod}`;
}
