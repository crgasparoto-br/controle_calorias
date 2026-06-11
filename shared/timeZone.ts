export const DEFAULT_APP_TIME_ZONE = "America/Sao_Paulo";

export const USER_TIME_ZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "UTC-03:00 - Brasília/São Paulo" },
  { value: "America/Manaus", label: "UTC-04:00 - Manaus" },
  { value: "America/Rio_Branco", label: "UTC-05:00 - Rio Branco" },
  { value: "America/Noronha", label: "UTC-02:00 - Fernando de Noronha" },
  { value: "America/New_York", label: "UTC-05:00 - Nova York" },
  { value: "America/Chicago", label: "UTC-06:00 - Chicago" },
  { value: "America/Denver", label: "UTC-07:00 - Denver" },
  { value: "America/Los_Angeles", label: "UTC-08:00 - Los Angeles" },
  { value: "Europe/Lisbon", label: "UTC+00:00 - Lisboa" },
  { value: "UTC", label: "UTC+00:00 - Universal" },
] as const;

const USER_TIME_ZONE_VALUES: Set<string> = new Set(USER_TIME_ZONE_OPTIONS.map(option => option.value));

export function normalizeUserTimeZone(value: string | null | undefined) {
  return value && USER_TIME_ZONE_VALUES.has(value) ? value : DEFAULT_APP_TIME_ZONE;
}

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
