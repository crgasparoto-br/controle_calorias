import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 42, name: "Paciente Teste", email: "paciente@example.com" },
  }),
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("@/components/PageIntro", () => ({
  default: ({ title, stats, actions }: { title: string; stats?: React.ReactNode; actions?: React.ReactNode }) => React.createElement("header", null, title, stats, actions),
}));

vi.mock("@/components/ProfessionalProfileSettings", () => ({
  default: () => React.createElement("section", null, "Configurações profissionais"),
  PatientAccessRequestsCard: ({ embedded }: { embedded?: boolean }) => React.createElement(
    "section",
    { "data-embedded": embedded ? "true" : "false" },
    "Solicitações de acesso renderizadas na aba Perfil",
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const invalidateMock = vi.fn(async () => undefined);
const mutateMock = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        whatsapp: { status: { invalidate: invalidateMock } },
        onboarding: { profile: { invalidate: invalidateMock } },
        goals: { get: { invalidate: invalidateMock } },
        dashboard: { overview: { invalidate: invalidateMock }, today: { invalidate: invalidateMock } },
        reports: { weekly: { invalidate: invalidateMock } },
        mealSchedules: { list: { invalidate: invalidateMock } },
      },
    }),
    auth: {
      sendWhatsappGreeting: {
        useMutation: () => ({ isPending: false, mutateAsync: async () => ({ status: "skipped", reason: "no_phone", detail: "Sem telefone" }) }),
      },
    },
    nutrition: {
      whatsapp: {
        status: { useQuery: () => ({ data: { connection: null } }) },
        upsertConnection: { useMutation: () => ({ isPending: false, mutateAsync: async () => undefined }) },
      },
      onboarding: {
        profile: { useQuery: () => ({ data: null }) },
        complete: { useMutation: () => ({ isPending: false, mutate: mutateMock }) },
      },
      mealSchedules: {
        list: { useQuery: () => ({ data: null }) },
        update: { useMutation: () => ({ isPending: false, mutate: mutateMock }) },
      },
      professionals: {
        profile: { useQuery: () => ({ data: { active: false }, isLoading: false, isError: false }) },
      },
    },
  },
}));

describe("OnboardingPage profile tab", () => {
  it("renderiza o card de solicitações diretamente na aba Perfil", async () => {
    const { default: OnboardingPage } = await import("./OnboardingPage");
    const html = renderToString(React.createElement(OnboardingPage));

    expect(html).toContain("Atualize seus dados, metas e acompanhamentos");
    expect(html).toContain("Identificação e base física");
    expect(html).toContain("Solicitações de acesso renderizadas na aba Perfil");
    expect(html).toContain("data-embedded=\"true\"");
  });
});