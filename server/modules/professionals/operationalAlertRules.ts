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
  return values as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

export function startOfCalendarDayInZone(date: Date, timeZone: string) {
  const [year, month, day] = getDateKeyInZone(date, timeZone).split("-").map(Number);
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

export function getNoFoodRecordsWindow(now: Date, timeZone: string) {
  const currentDayStart = startOfCalendarDayInZone(now, timeZone);
  return {
    start: new Date(currentDayStart.getTime() - 3 * 24 * 60 * 60 * 1000),
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
