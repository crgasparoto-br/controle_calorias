const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const DEFAULT_LOCALE = "pt-BR";
const TIME_ZONE_STORAGE_KEY = "controle-calorias:time-zone";
const LOCALE_STORAGE_KEY = "controle-calorias:locale";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function readStorage(key: string): string | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }

  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return;
  }

  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors to keep formatting helpers usable in restricted contexts
  }
}

function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;

  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function isValidLocale(value: string | null | undefined): value is string {
  if (!value) return false;

  try {
    return Intl.NumberFormat.supportedLocalesOf([value]).length > 0;
  } catch {
    return false;
  }
}

function getDateTimeParts(date: Date, timeZone: string) {
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

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getDateTimeParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
}

export function getBrowserTimeZone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(detected) ? detected : DEFAULT_TIME_ZONE;
}

export function getBrowserLocale(): string {
  if (typeof navigator !== "undefined") {
    const [preferred] = navigator.languages ?? [];
    if (isValidLocale(preferred)) return preferred;
    if (isValidLocale(navigator.language)) return navigator.language;
  }

  const detected = Intl.DateTimeFormat().resolvedOptions().locale;
  return isValidLocale(detected) ? detected : DEFAULT_LOCALE;
}

export function getPreferredTimeZone() {
  const stored = readStorage(TIME_ZONE_STORAGE_KEY);
  if (isValidTimeZone(stored)) return stored;
  return getBrowserTimeZone();
}

export function getPreferredLocale() {
  const stored = readStorage(LOCALE_STORAGE_KEY);
  if (isValidLocale(stored)) return stored;
  return getBrowserLocale();
}

function normalizeTimeZone(value: string | null | undefined) {
  return isValidTimeZone(value) ? value : getBrowserTimeZone();
}

function normalizeLocale(value: string | null | undefined) {
  return isValidLocale(value) ? value : DEFAULT_LOCALE;
}

export function persistPreferredLocaleSettings(input: { timeZone?: string | null; locale?: string | null }) {
  const timeZone = normalizeTimeZone(input.timeZone);
  const locale = normalizeLocale(input.locale);

  writeStorage(TIME_ZONE_STORAGE_KEY, timeZone);
  writeStorage(LOCALE_STORAGE_KEY, locale);

  return { timeZone, locale };
}

export function formatDateTimeInTimeZone(
  value: number | string | Date,
  timeZone?: string | null,
  locale?: string | null,
) {
  return new Intl.DateTimeFormat(normalizeLocale(locale ?? getPreferredLocale()), {
    timeZone: normalizeTimeZone(timeZone ?? getPreferredTimeZone()),
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDateInTimeZone(
  value: number | string | Date,
  timeZone?: string | null,
  locale?: string | null,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(normalizeLocale(locale ?? getPreferredLocale()), {
    timeZone: normalizeTimeZone(timeZone ?? getPreferredTimeZone()),
    dateStyle: "short",
    ...options,
  }).format(new Date(value));
}

export function formatTimeInTimeZone(
  value: number | string | Date,
  timeZone?: string | null,
  locale?: string | null,
) {
  return new Intl.DateTimeFormat(normalizeLocale(locale ?? getPreferredLocale()), {
    timeZone: normalizeTimeZone(timeZone ?? getPreferredTimeZone()),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function toDateInputValue(date = new Date(), timeZone?: string | null) {
  const parts = getDateTimeParts(date, normalizeTimeZone(timeZone ?? getPreferredTimeZone()));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function toDateTimeLocalValue(date = new Date(), timeZone?: string | null) {
  const parts = getDateTimeParts(date, normalizeTimeZone(timeZone ?? getPreferredTimeZone()));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function zonedDateTimeLocalToIso(value: string, timeZone?: string | null) {
  const normalizedTimeZone = normalizeTimeZone(timeZone ?? getPreferredTimeZone());
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0));
  const firstOffset = getTimeZoneOffsetMs(utcGuess, normalizedTimeZone);
  const firstInstant = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(firstInstant, normalizedTimeZone);

  return new Date(utcGuess.getTime() - secondOffset).toISOString();
}
