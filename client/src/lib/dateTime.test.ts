import { beforeEach, describe, expect, it } from "vitest";
import {
  formatDateTimeInTimeZone,
  formatTimeInTimeZone,
  persistPreferredLocaleSettings,
  toDateInputValue,
  toDateTimeLocalValue,
  zonedDateTimeLocalToIso,
} from "./dateTime";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
});

describe("dateTime helpers", () => {
  it("converte datetime-local no fuso informado para ISO sem perder o horário local", () => {
    const iso = zonedDateTimeLocalToIso("2026-04-25T12:30", "America/Sao_Paulo");

    expect(iso).toBe("2026-04-25T15:30:00.000Z");
    expect(toDateTimeLocalValue(new Date(iso), "America/Sao_Paulo")).toBe("2026-04-25T12:30");
  });

  it("formata data e hora no fuso informado", () => {
    const instant = "2026-04-25T15:30:00.000Z";

    expect(toDateInputValue(new Date(instant), "America/Sao_Paulo")).toBe("2026-04-25");
    expect(formatDateTimeInTimeZone(instant, "America/Sao_Paulo", "pt-BR")).toContain("12:30");
  });

  it("usa locale e fuso horario persistidos quando nao recebe override", () => {
    const instant = "2026-04-25T15:30:00.000Z";

    persistPreferredLocaleSettings({ locale: "pt-BR", timeZone: "America/Sao_Paulo" });

    expect(formatDateTimeInTimeZone(instant)).toContain("25/04/2026");
    expect(formatTimeInTimeZone(instant)).toContain("12:30");
  });
});
