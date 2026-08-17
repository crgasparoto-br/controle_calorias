import { describe, expect, it } from "vitest";
import { OwnerLocalDateTimeInputError, resolveOwnerLocalDateTime } from "./civilInput";

describe("owner local datetime input", () => {
  it("converte o horário civil no timezone do dono", () => {
    expect(resolveOwnerLocalDateTime("2026-07-16T14:30", "Europe/Lisbon"))
      .toBe("2026-07-16T13:30:00.000Z");
  });

  it("rejeita horário inexistente no avanço do DST", () => {
    expect(() => resolveOwnerLocalDateTime("2026-03-08T02:30", "America/New_York"))
      .toThrow(OwnerLocalDateTimeInputError);
  });

  it("usa a primeira ocorrência no horário ambíguo", () => {
    expect(resolveOwnerLocalDateTime("2026-11-01T01:30", "America/New_York"))
      .toBe("2026-11-01T05:30:00.000Z");
  });
});
