export function getDateKeyInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)])
  );
  return values as Record<
    "year" | "month" | "day" | "hour" | "minute" | "second",
    number
  >;
}

function startOfDateKeyInZone(dateKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day);
  const represented = parts(new Date(utcGuess), timeZone);
  const representedAsUtc = Date.UTC(
    represented.year,
    represented.month - 1,
    represented.day,
    represented.hour,
    represented.minute,
    represented.second
  );
  return new Date(utcGuess - (representedAsUtc - utcGuess));
}

export function startOfCalendarDayInZone(date: Date, timeZone: string) {
  return startOfDateKeyInZone(getDateKeyInZone(date, timeZone), timeZone);
}

function subtractCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - days));
  return date.toISOString().slice(0, 10);
}

export function getNoFoodRecordsWindow(now: Date, timeZone: string) {
  const currentDateKey = getDateKeyInZone(now, timeZone);
  return {
    start: startOfDateKeyInZone(
      subtractCalendarDays(currentDateKey, 3),
      timeZone
    ),
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
