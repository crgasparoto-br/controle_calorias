const ISO_DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

export function formatOperationalAlertReason(reason: string) {
  return reason.replace(
    ISO_DATE_PATTERN,
    (_match, year: string, month: string, day: string) =>
      `${day}/${month}/${year}`
  );
}
