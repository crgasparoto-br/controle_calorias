import { describe, expect, it } from "vitest";
import { getDateKeyInTimeZone, getWeekdayIndexInTimeZone, toLogicalDateInTimeZone } from "./timeZone";

describe("shared timezone helpers", () => {
  it("converte um instante para a data local do fuso configurado", () => {
    expect(getDateKeyInTimeZone("2026-05-22T02:30:00.000Z", "America/Sao_Paulo")).toBe("2026-05-21");
    expect(getDateKeyInTimeZone("2026-05-22T02:30:00.000Z", "UTC")).toBe("2026-05-22");
  });

  it("mantem a semana baseada na data local em vez do UTC puro", () => {
    expect(getWeekdayIndexInTimeZone("2026-05-25T02:30:00.000Z", "America/Sao_Paulo")).toBe(6);
    expect(getWeekdayIndexInTimeZone("2026-05-25T12:00:00.000Z", "America/Sao_Paulo")).toBe(0);
  });

  it("gera uma data logica estavel para calculos semanais", () => {
    expect(toLogicalDateInTimeZone("2026-05-22T02:30:00.000Z", "America/Sao_Paulo").toISOString()).toBe("2026-05-21T12:00:00.000Z");
  });
});
