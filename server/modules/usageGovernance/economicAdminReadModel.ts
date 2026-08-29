export function economicAdminMonthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("invalid_economic_month");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error("invalid_economic_month");
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1));
  const historyFrom = new Date(Date.UTC(year, monthIndex - 2, 1));
  return { from, to, historyFrom };
}

export function isEconomicAdminRowInMonth(value: Date | string, month: string) {
  const { from, to } = economicAdminMonthRange(month);
  const timestamp = new Date(value).getTime();
  return timestamp >= from.getTime() && timestamp < to.getTime();
}
