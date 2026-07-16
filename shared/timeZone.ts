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

export type UserTimeZoneFallbackReason = "profile_missing" | "empty" | "invalid";

export type UserTimeZoneValueResolution = {
  timeZone: string;
  source: "profile" | "fallback";
  fallbackReason?: UserTimeZoneFallbackReason;
};

export type ZonedDateTimeErrorCode = "invalid_format" | "invalid_time_zone" | "nonexistent_local_time";

export class ZonedDateTimeError extends Error {
  readonly code: ZonedDateTimeErrorCode;

  constructor(code: ZonedDateTimeErrorCode, message: string) {
    super(message);
    this.name = "ZonedDateTimeError";
    this.code = code;
  }
}

export function isValidIanaTimeZone(value: string | null | undefined): value is string {
  const candidate = value?.trim();
  if (!candidate) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function resolveUserTimeZoneValue(
  value: string | null | undefined,
  options: { profileExists?: boolean } = {},
): UserTimeZoneValueResolution {
  if (options.profileExists === false) {
    return {
      timeZone: DEFAULT_APP_TIME_ZONE,
      source: "fallback",
      fallbackReason: "profile_missing",
    };
  }

  const candidate = value?.trim();
  if (!candidate) {
    return {
      timeZone: DEFAULT_APP_TIME_ZONE,
      source: "fallback",
      fallbackReason: "empty",
    };
  }

  if (!isValidIanaTimeZone(candidate)) {
    return {
      timeZone: DEFAULT_APP_TIME_ZONE,
      source: "fallback",
      fallbackReason: "invalid",
    };
  }

  return { timeZone: candidate, source: "profile" };
}

export function normalizeUserTimeZone(value: string | null | undefined) {
  return resolveUserTimeZoneValue(value).timeZone;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function getDateTimePartsInTimeZone(
  value: number | string | Date,
  timeZone = DEFAULT_APP_TIME_ZONE,
): DateTimeParts {
  const date = new Date(value);
  const normalizedTimeZone = normalizeUserTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizedTimeZone,
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
  const parts = getDateTimePartsInTimeZone(value, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function getWeekdayIndexInTimeZone(value: number | string | Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const logicalDate = toLogicalDateInTimeZone(value, timeZone);
  return (logicalDate.getUTCDay() + 6) % 7;
}

export function toLogicalDateInTimeZone(value: number | string | Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const parts = getDateTimePartsInTimeZone(value, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0));
}

export function toDateTimeLocalValueInTimeZone(value: number | string | Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  const parts = getDateTimePartsInTimeZone(value, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function parseDateTimeLocal(value: string): DateTimeParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) {
    throw new ZonedDateTimeError(
      "invalid_format",
      "Informe a data e o horário no formato local esperado.",
    );
  }

  const parts: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const validationDate = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ));

  if (
    validationDate.getUTCFullYear() !== parts.year
    || validationDate.getUTCMonth() !== parts.month - 1
    || validationDate.getUTCDate() !== parts.day
    || validationDate.getUTCHours() !== parts.hour
    || validationDate.getUTCMinutes() !== parts.minute
    || validationDate.getUTCSeconds() !== parts.second
  ) {
    throw new ZonedDateTimeError("invalid_format", "Informe uma data e um horário válidos.");
  }

  return parts;
}

function dateTimePartsEqual(left: DateTimeParts, right: DateTimeParts) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getDateTimePartsInTimeZone(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return localAsUtc - Math.trunc(date.getTime() / 1000) * 1000;
}

/**
 * Converte um horário civil para um instante absoluto.
 *
 * Em horários ambíguos de retorno do DST, escolhe a primeira ocorrência
 * (o menor instante UTC, correspondente ao offset anterior). Horários locais
 * inexistentes no avanço do DST são rejeitados por round-trip.
 */
export function zonedDateTimeLocalToDate(value: string, timeZone: string) {
  const normalizedTimeZone = timeZone.trim();
  if (!isValidIanaTimeZone(normalizedTimeZone)) {
    throw new ZonedDateTimeError("invalid_time_zone", "O fuso horário configurado é inválido.");
  }

  const target = parseDateTimeLocal(value);
  const utcGuessMs = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  const offsets = new Set<number>();

  for (let hours = -48; hours <= 48; hours += 6) {
    offsets.add(getTimeZoneOffsetMs(new Date(utcGuessMs + hours * 60 * 60 * 1000), normalizedTimeZone));
  }

  const candidates = Array.from(offsets)
    .map(offset => new Date(utcGuessMs - offset))
    .filter(candidate => dateTimePartsEqual(getDateTimePartsInTimeZone(candidate, normalizedTimeZone), target))
    .sort((left, right) => left.getTime() - right.getTime());

  const selected = candidates[0];
  if (!selected) {
    throw new ZonedDateTimeError(
      "nonexistent_local_time",
      "Esse horário não existe no fuso configurado por causa da mudança de horário de verão. Escolha outro horário.",
    );
  }

  return selected;
}

export function zonedDateTimeLocalToIso(value: string, timeZone: string) {
  return zonedDateTimeLocalToDate(value, timeZone).toISOString();
}

function assertDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ZonedDateTimeError("invalid_format", "Informe a data no formato AAAA-MM-DD.");
  }

  parseDateTimeLocal(`${value}T00:00:00`);
  return value;
}

export function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = assertDateKey(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function getUtcRangeForLocalDate(
  dateKey: string,
  timeZone: string,
): { startAt: Date; endAt: Date } {
  return getUtcRangeForLocalDateRange(dateKey, addCalendarDays(dateKey, 1), timeZone);
}

export function getUtcRangeForLocalDateRange(
  startDateInclusive: string,
  endDateExclusive: string,
  timeZone: string,
): { startAt: Date; endAt: Date } {
  assertDateKey(startDateInclusive);
  assertDateKey(endDateExclusive);

  if (startDateInclusive >= endDateExclusive) {
    throw new ZonedDateTimeError("invalid_format", "O fim do período deve ser posterior ao início.");
  }

  return {
    startAt: zonedDateTimeLocalToDate(`${startDateInclusive}T00:00:00`, timeZone),
    endAt: zonedDateTimeLocalToDate(`${endDateExclusive}T00:00:00`, timeZone),
  };
}


export function listCalendarDateKeys(startDateInclusive: string, endDateInclusive: string) {
  assertDateKey(startDateInclusive);
  assertDateKey(endDateInclusive);

  if (startDateInclusive > endDateInclusive) {
    throw new ZonedDateTimeError("invalid_format", "O fim do período deve ser igual ou posterior ao início.");
  }

  const dates: string[] = [];
  let current = startDateInclusive;
  while (current <= endDateInclusive) {
    dates.push(current);
    current = addCalendarDays(current, 1);
  }
  return dates;
}

export function getWeekDateKeys(
  reference: number | string | Date,
  timeZone: string,
  weekOffset = 0,
) {
  const referenceKey = getDateKeyInTimeZone(reference, timeZone);
  const weekdayIndex = getWeekdayIndexInTimeZone(reference, timeZone);
  const monday = addCalendarDays(referenceKey, (-weekdayIndex) + (weekOffset * 7));
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index));
}

export function getUtcRangeForInclusiveLocalDateRange(
  startDateInclusive: string,
  endDateInclusive: string,
  timeZone: string,
) {
  return getUtcRangeForLocalDateRange(
    startDateInclusive,
    addCalendarDays(endDateInclusive, 1),
    timeZone,
  );
}
