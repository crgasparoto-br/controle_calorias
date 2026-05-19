import { describe, expect, it } from "vitest";
import { formatDateTimeInTimeZone, toDateInputValue, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "./dateTime";

describe("dateTime helpers", () => {
  it("converte datetime-local no fuso informado para ISO sem perder o horário local", () => {
    const iso = zonedDateTimeLocalToIso("2026-04-25T12:30", "America/Sao_Paulo");

    expect(iso).toBe("2026-04-25T15:30:00.000Z");
    expect(toDateTimeLocalValue(new Date(iso), "America/Sao_Paulo")).toBe("2026-04-25T12:30");
  });

  it("formata data e hora no fuso informado", () => {
    const instant = "2026-04-25T15:30:00.000Z";

    expect(toDateInputValue(new Date(instant), "America/Sao_Paulo")).toBe("2026-04-25");
    expect(formatDateTimeInTimeZone(instant, "America/Sao_Paulo")).toContain("12:30");
  });
});
