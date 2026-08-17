import {
  DEFAULT_APP_TIME_ZONE,
  getDateKeyInTimeZone,
  normalizeUserTimeZone,
  toDateTimeLocalValueInTimeZone,
  zonedDateTimeLocalToIso as sharedZonedDateTimeLocalToIso,
} from "@shared/timeZone";

export function formatDateTimeInTimeZone(
  value: number | string | Date,
  timeZone = DEFAULT_APP_TIME_ZONE,
) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: normalizeUserTimeZone(timeZone),
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function toDateInputValue(
  date: number | string | Date = new Date(),
  timeZone = DEFAULT_APP_TIME_ZONE,
) {
  return getDateKeyInTimeZone(date, timeZone);
}

export function toDateTimeLocalValue(
  date: number | string | Date = new Date(),
  timeZone = DEFAULT_APP_TIME_ZONE,
) {
  return toDateTimeLocalValueInTimeZone(date, timeZone);
}

export function zonedDateTimeLocalToIso(value: string, timeZone = DEFAULT_APP_TIME_ZONE) {
  return sharedZonedDateTimeLocalToIso(value, timeZone);
}
