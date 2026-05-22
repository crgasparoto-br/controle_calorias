export const DEFAULT_APP_TIME_ZONE = "America/Sao_Paulo";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getDateTimeParts(value: number | string | Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const hour = Number(values.hour === "24" ? "00" : values.hour);

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function getDateKeyInTimeZone(value: number | string | Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const parts = getDateTimeParts(value, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function getWeekdayIndexInTimeZone(value: number | string | Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const logicalDate = toLogicalDateInTimeZone(value, timeZone);
  return (logicalDate.getUTCDay() + 6) % 7;
}

export function toLogicalDateInTimeZone(value: number | string | Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const parts = getDateTimeParts(value, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0));
}
