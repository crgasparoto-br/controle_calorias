import { describe, expect, it } from "vitest";
import { formatDateTimeInTimeZone, toDateInputValue, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "./dateTime";

describe("dateTime helpers", () => {
  it("converte datetime-local no fuso informado para ISO sem perder o horário local", () => {
    const iso = zonedDateTimeLocalToIso("2026-04-25T12:30", "America/Sao_Paulo");

    expect(iso).toBe("2026-04-25T15:30:00.000Z");
    expect(toDateTimeLocalValue(new Date(iso), "America/Sao_Paulo")).toBe("2026-04-25T12:30");
  });

  it("gera a chave de data local esperada para filtros diários", () => {
    const instant = "2026-05-22T02:30:00.000Z";

    expect(toDateInputValue(new Date(instant), "America/Sao_Paulo")).toBe("2026-05-21");
    expect(toDateInputValue(new Date(instant), "UTC")).toBe("2026-05-22");
  });

  it("rejeita horário local inexistente e escolhe a primeira ocorrência ambígua", () => {
    expect(() => zonedDateTimeLocalToIso("2026-03-08T02:30", "America/New_York"))
      .toThrow("Esse horário não existe");
    expect(zonedDateTimeLocalToIso("2026-11-01T01:30", "America/New_York"))
      .toBe("2026-11-01T05:30:00.000Z");
  });

  it("mantém o timezone explícito mesmo quando difere do navegador", () => {
    const instant = "2026-07-16T23:30:00.000Z";
    expect(toDateInputValue(instant, "Europe/Lisbon")).toBe("2026-07-17");
    expect(toDateInputValue(instant, "America/Sao_Paulo")).toBe("2026-07-16");
  });

  it("formata data e hora no fuso informado", () => {
    const instant = "2026-04-25T15:30:00.000Z";

    expect(formatDateTimeInTimeZone(instant, "America/Sao_Paulo")).toContain("12:30");
  });
});
