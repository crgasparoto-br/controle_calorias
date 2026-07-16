import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEffectiveUserTimeZone = vi.fn();

vi.mock("../timeZone/service", () => ({
  resolveEffectiveUserTimeZone,
}));

const {
  getWhatsAppOperationTimeZone,
  resolveInjectedWhatsAppTimeZone,
  resolveWhatsAppOperationTimeZone,
  runWithWhatsAppTimeZoneRequestScope,
} = await import("./timeZoneContext");

describe("WhatsApp time zone operation context", () => {
  beforeEach(() => {
    resolveEffectiveUserTimeZone.mockReset();
  });

  it("resolves the persisted timezone only once per user in the same inbound scope", async () => {
    resolveEffectiveUserTimeZone.mockResolvedValue({ timeZone: "Europe/Lisbon", source: "profile" });

    await runWithWhatsAppTimeZoneRequestScope(async () => {
      await expect(getWhatsAppOperationTimeZone(7)).resolves.toBe("Europe/Lisbon");
      await expect(resolveWhatsAppOperationTimeZone(7)).resolves.toEqual({
        timeZone: "Europe/Lisbon",
        source: "profile",
      });
    });

    expect(resolveEffectiveUserTimeZone).toHaveBeenCalledTimes(1);
    expect(resolveEffectiveUserTimeZone).toHaveBeenCalledWith(7);
  });

  it("does not convert a database failure into a fallback", async () => {
    const failure = new Error("database unavailable");
    resolveEffectiveUserTimeZone.mockRejectedValue(failure);

    await expect(runWithWhatsAppTimeZoneRequestScope(() => getWhatsAppOperationTimeZone(8)))
      .rejects.toBe(failure);
  });

  it.each([
    ["America/New_York", "America/New_York", "profile"],
    ["Europe/Lisbon", "Europe/Lisbon", "profile"],
    ["UTC", "UTC", "profile"],
    ["Invalid/Zone", "America/Sao_Paulo", "fallback"],
    [undefined, "America/Sao_Paulo", "fallback"],
  ])("keeps simulator injection aligned with the shared resolver: %s", (input, timeZone, source) => {
    expect(resolveInjectedWhatsAppTimeZone(input)).toMatchObject({ timeZone, source });
  });
});
