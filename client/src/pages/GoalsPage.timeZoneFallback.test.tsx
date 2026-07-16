import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { goalGetMock } = vi.hoisted(() => ({
  goalGetMock: vi.fn(() => ({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
  })),
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("@/hooks/useEffectiveUserTimeZone", () => ({
  useEffectiveUserTimeZone: () => ({
    timeZone: "America/Sao_Paulo",
    source: "fallback",
    fallbackReason: undefined,
    isReady: true,
    isAuthoritative: false,
    isUsingFallback: true,
    hasResolutionError: true,
    resolutionError: new Error("timezone endpoint unavailable"),
    isSuccess: true,
    isError: false,
    error: null,
    status: "success",
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        goals: { get: { invalidate: vi.fn() } },
        onboarding: { timeZone: { invalidate: vi.fn() } },
        dashboard: {
          overview: { invalidate: vi.fn() },
          today: { invalidate: vi.fn() },
        },
        reports: { weekly: { invalidate: vi.fn() } },
      },
    }),
    nutrition: {
      goals: {
        get: { useQuery: goalGetMock },
        update: {
          useMutation: () => ({
            isPending: false,
            mutate: vi.fn(),
          }),
        },
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

describe("GoalsPage timezone fallback", () => {
  it("renderiza metas e inicia a consulta quando o fallback degradado está resolvido", async () => {
    const { default: GoalsPage } = await import("./GoalsPage");
    const html = renderToString(React.createElement(GoalsPage));

    expect(goalGetMock).toHaveBeenCalledWith(undefined, { enabled: true });
    expect(html).toContain("Metas nutricionais");
    expect(html).toContain("Meta geral da semana");
    expect(html).not.toContain("Carregando fuso horário do perfil");
  });
});
