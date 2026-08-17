import { toDateInputValue } from "@/lib/dateTime";

export type PeriodScope = "day" | "week" | "month" | "range";

export type DateRangeValue = {
  start: string;
  end: string;
};

function parseDateInputValue(dateInputValue: string) {
  const [year, month, day] = dateInputValue.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatMonthValue(date: Date) {
  return formatDateInputValue(date).slice(0, 7);
}

export function addDaysToDateValue(dateInputValue: string, days: number) {
  const date = parseDateInputValue(dateInputValue);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateInputValue(date);
}

export function addWeeksToDateValue(dateInputValue: string, weeks: number) {
  return addDaysToDateValue(dateInputValue, weeks * 7);
}

export function toMonthInputValue(date = new Date(), timeZone?: string) {
  return toDateInputValue(date, timeZone).slice(0, 7);
}

export function addMonthsToMonthValue(monthInputValue: string, months: number) {
  const [year, month] = monthInputValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + months);
  return formatMonthValue(date);
}

export function getWeekRange(dateInputValue: string): DateRangeValue {
  const date = parseDateInputValue(dateInputValue);
  const weekDay = date.getUTCDay();
  const distanceFromMonday = weekDay === 0 ? 6 : weekDay - 1;
  date.setUTCDate(date.getUTCDate() - distanceFromMonday);
  const start = formatDateInputValue(date);
  return {
    start,
    end: addDaysToDateValue(start, 6),
  };
}

export function getMonthRange(monthInputValue: string): DateRangeValue {
  const [year, month] = monthInputValue.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    start: formatDateInputValue(start),
    end: formatDateInputValue(end),
  };
}

export function normalizeDateRange(start: string, end: string): DateRangeValue {
  if (start <= end) {
    return { start, end };
  }

  return { start: end, end: start };
}

export function isDateWithinRange(dateInputValue: string, range: DateRangeValue) {
  return dateInputValue >= range.start && dateInputValue <= range.end;
}

export function listDateRangeDays(range: DateRangeValue) {
  const days: string[] = [];
  let current = range.start;

  while (current <= range.end) {
    days.push(current);
    current = addDaysToDateValue(current, 1);
  }

  return days;
}

export function countDaysInRange(range: DateRangeValue) {
  return listDateRangeDays(range).length;
}

export function getWeekOffsetFromToday(anchorDay: string, timeZone: string) {
  const currentWeekStart = getWeekRange(toDateInputValue(new Date(), timeZone)).start;
  const selectedWeekStart = getWeekRange(anchorDay).start;
  const diffMs = parseDateInputValue(selectedWeekStart).getTime() - parseDateInputValue(currentWeekStart).getTime();
  return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
}

export function formatDateLabel(dateInputValue: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${dateInputValue}T12:00:00`).toLocaleDateString("pt-BR", options ?? {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatMonthLabel(monthInputValue: string) {
  return new Date(`${monthInputValue}-01T12:00:00`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

export function formatRangeLabel(range: DateRangeValue) {
  if (range.start === range.end) {
    return formatDateLabel(range.start);
  }

  return `${formatDateLabel(range.start, { day: "2-digit", month: "short" })} a ${formatDateLabel(range.end, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}
