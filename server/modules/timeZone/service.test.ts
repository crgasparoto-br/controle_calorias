import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import {
  createEffectiveUserTimeZoneService,
  UserTimeZoneResolutionError,
} from "./service";

describe("effectiveUserTimeZoneService", () => {
  it("preserva timezone IANA valido fora das opcoes visuais", async () => {
    const service = createEffectiveUserTimeZoneService({
      readProfileTimeZone: vi.fn(async () => ({ profileExists: true, timeZone: "Asia/Tokyo" })),
    });

    await expect(service.resolve(1)).resolves.toEqual({
      timeZone: "Asia/Tokyo",
      source: "profile",
    });
  });

  it.each([
    [{ profileExists: false, timeZone: null }, "profile_missing"],
    [{ profileExists: true, timeZone: "" }, "empty"],
    [{ profileExists: true, timeZone: "Invalid/Zone" }, "invalid"],
  ] as const)("usa fallback explicito para %j", async (stored, reason) => {
    const onFallback = vi.fn();
    const service = createEffectiveUserTimeZoneService({
      readProfileTimeZone: vi.fn(async () => stored),
      onFallback,
    });

    await expect(service.resolve(2)).resolves.toEqual({
      timeZone: DEFAULT_APP_TIME_ZONE,
      source: "fallback",
      fallbackReason: reason,
    });
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(reason);
  });

  it("nao mascara falha tecnica como perfil ausente", async () => {
    const service = createEffectiveUserTimeZoneService({
      readProfileTimeZone: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    await expect(service.resolve(3)).rejects.toBeInstanceOf(UserTimeZoneResolutionError);
  });
});
