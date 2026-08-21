// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useTimeZoneQueryMock } = vi.hoisted(() => ({
  useTimeZoneQueryMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    nutrition: {
      onboarding: {
        timeZone: {
          useQuery: (...args: unknown[]) => useTimeZoneQueryMock(...args),
        },
      },
    },
  },
}));

import { useEffectiveUserTimeZone } from "./useEffectiveUserTimeZone";

describe("useEffectiveUserTimeZone", () => {
  beforeEach(() => {
    useTimeZoneQueryMock.mockReset();
  });

  it("mantém fluxos temporais bloqueados enquanto a resolução está pendente", () => {
    useTimeZoneQueryMock.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isSuccess: false,
      status: "pending",
    });

    const { result } = renderHook(() => useEffectiveUserTimeZone());

    expect(result.current.isReady).toBe(false);
    expect(result.current.isAuthoritative).toBe(false);
    expect(result.current.timeZone).toBe("America/Sao_Paulo");
    expect(useTimeZoneQueryMock).toHaveBeenCalledWith(undefined, {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    });
  });

  it("preserva o timezone autoritativo quando a consulta retorna sucesso", () => {
    useTimeZoneQueryMock.mockReturnValue({
      data: {
        timeZone: "America/Manaus",
        source: "profile",
        fallbackReason: undefined,
      },
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    });

    const { result } = renderHook(() => useEffectiveUserTimeZone());

    expect(result.current.isReady).toBe(true);
    expect(result.current.isAuthoritative).toBe(true);
    expect(result.current.isUsingFallback).toBe(false);
    expect(result.current.timeZone).toBe("America/Manaus");
    expect(result.current.hasResolutionError).toBe(false);
  });

  it("normaliza erro definitivo como fallback resolvido para não travar a navegação", () => {
    const resolutionError = new Error("timezone endpoint unavailable");
    useTimeZoneQueryMock.mockReturnValue({
      data: undefined,
      error: resolutionError,
      isError: true,
      isSuccess: false,
      status: "error",
    });

    const { result } = renderHook(() => useEffectiveUserTimeZone());

    expect(result.current.status).toBe("success");
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isReady).toBe(true);
    expect(result.current.isAuthoritative).toBe(false);
    expect(result.current.isUsingFallback).toBe(true);
    expect(result.current.timeZone).toBe("America/Sao_Paulo");
    expect(result.current.hasResolutionError).toBe(true);
    expect(result.current.resolutionError).toBe(resolutionError);
  });
});
