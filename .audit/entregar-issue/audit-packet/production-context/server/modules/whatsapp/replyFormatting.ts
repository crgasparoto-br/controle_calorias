import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";

export function formatWhatsAppMacro(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatWhatsAppReplyTime(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}
