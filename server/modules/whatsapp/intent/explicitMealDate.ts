import { resolveRelativeOccurredAt } from "./dateTime";
import { normalizeIntentText } from "./textUtils";

const EXPLICIT_RELATIVE_MEAL_DATE_PATTERN = /\b(?:hoje|ontem|anteontem|amanha)\b/;

export type WhatsappRelativeMealDateSelection = {
  date: Date;
  explicit: boolean;
};

export function hasExplicitWhatsappRelativeMealDate(text?: string | null) {
  if (!text?.trim()) return false;
  return EXPLICIT_RELATIVE_MEAL_DATE_PATTERN.test(normalizeIntentText(text));
}

export function resolveWhatsappRelativeMealDateSelection(input: {
  text?: string | null;
  receivedAt: Date;
  timeZone: string;
  fallbackDate: Date;
}): WhatsappRelativeMealDateSelection {
  if (!hasExplicitWhatsappRelativeMealDate(input.text)) {
    return { date: input.fallbackDate, explicit: false };
  }

  return {
    date: resolveRelativeOccurredAt(input.text!, input.receivedAt, input.timeZone),
    explicit: true,
  };
}
