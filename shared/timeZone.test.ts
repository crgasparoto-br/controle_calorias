import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_TIME_ZONE,
  getDateKeyInTimeZone,
  getUtcRangeForInclusiveLocalDateRange,
  getWeekdayIndexInTimeZone,
  isValidIanaTimeZone,
  normalizeUserTimeZone,
  resolveUserTimeZoneValue,
  toDateTimeLocalValueInTimeZone,
  toLogicalDateInTimeZone,
  ZonedDateTimeError,
  zonedDateTimeLocalToDate,
} from "./timeZone";

describe("shared timezone helpers", () => {
  it("mantem valores IANA validos mesmo fora da lista visual", () => {
    expect(isValidIanaTimeZone("Asia/Tokyo")).toBe(true);
    expect(normalizeUserTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(resolveUserTimeZoneValue("Asia/Tokyo")).toEqual({
      timeZone: "Asia/Tokyo",
      source: "profile",
    });
  });

  it("explicita fallback para perfil ausente, vazio e invalido", () => {
    expect(resolveUserTimeZoneValue(undefined, { profileExists: false })).toEqual({
      timeZone: DEFAULT_APP_TIME_ZONE,
      source: "fallback",
      fallbackReason: "profile_missing",
    });
    expect(resolveUserTimeZoneValue("  ")).toEqual({
      timeZone: DEFAULT_APP_TIME_ZONE,
      source: "fallback",
      fallbackReason: "empty",
    });
    expect(resolveUserTimeZoneValue("Mars/Olympus_Mons")).toEqual({
      timeZone: DEFAULT_APP_TIME_ZONE,
      source: "fallback",
      fallbackReason: "invalid",
    });
  });

  it("preserva UTC como timezone valido explicito", () => {
    expect(resolveUserTimeZoneValue("UTC")).toEqual({ timeZone: "UTC", source: "profile" });
  });

  it("resolve a data logica no timezone informado", () => {
    expect(getDateKeyInTimeZone("2026-05-22T02:30:00.000Z", "America/Sao_Paulo")).toBe("2026-05-21");
    expect(getDateKeyInTimeZone("2026-05-22T02:30:00.000Z", "UTC")).toBe("2026-05-22");
    expect(getDateKeyInTimeZone("2026-05-22T02:30:00.000Z", "Europe/Lisbon")).toBe("2026-05-22");
  });

  it("mantem a semana baseada na data local em vez do UTC puro", () => {
    expect(getWeekdayIndexInTimeZone("2026-05-25T02:30:00.000Z", "America/Sao_Paulo")).toBe(6);
    expect(getWeekdayIndexInTimeZone("2026-05-25T12:00:00.000Z", "America/Sao_Paulo")).toBe(0);
  });

  it("cria uma data logica estavel ao meio-dia UTC", () => {
    expect(toLogicalDateInTimeZone("2026-05-22T02:30:00.000Z", "America/Sao_Paulo").toISOString()).toBe("2026-05-21T12:00:00.000Z");
  });

  it("converte datetime-local por round-trip no timezone do dono", () => {
    const instant = zonedDateTimeLocalToDate("2026-07-16T09:30", "Europe/Lisbon");
    expect(instant.toISOString()).toBe("2026-07-16T08:30:00.000Z");
    expect(toDateTimeLocalValueInTimeZone(instant, "Europe/Lisbon")).toBe("2026-07-16T09:30");
  });

  it("rejeita horario inexistente no inicio do DST", () => {
    expect(() => zonedDateTimeLocalToDate("2026-03-08T02:30", "America/New_York"))
      .toThrow(ZonedDateTimeError);

    try {
      zonedDateTimeLocalToDate("2026-03-08T02:30", "America/New_York");
      throw new Error("expected nonexistent local time to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "nonexistent_local_time" });
    }
  });

  it("escolhe a primeira ocorrencia no horario ambiguo do fim do DST", () => {
    expect(zonedDateTimeLocalToDate("2026-11-01T01:30", "America/New_York").toISOString())
      .toBe("2026-11-01T05:30:00.000Z");
  });

  it("converte periodo civil inclusivo em intervalo UTC semiaberto", () => {
    expect(getUtcRangeForInclusiveLocalDateRange("2026-03-08", "2026-03-08", "America/New_York"))
      .toEqual({
        startAt: new Date("2026-03-08T05:00:00.000Z"),
        endAt: new Date("2026-03-09T04:00:00.000Z"),
      });
  });
});
