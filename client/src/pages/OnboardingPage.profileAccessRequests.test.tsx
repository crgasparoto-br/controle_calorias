// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  location: "/settings",
  preference: { data: { enabled: false } as { enabled: boolean } | undefined, isLoading: false, isError: false },
  failPreferenceSave: false,
}));
const toastErrorMock = vi.hoisted(() => vi.fn());
const updatePreferenceMock = vi.hoisted(() => vi.fn());

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

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
    error: toastErrorMock,
    warning: vi.fn(),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => [state.location, vi.fn()] as const,
}));

const invalidateMock = vi.fn(async () => undefined);
const mutateMock = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        whatsapp: { status: { invalidate: invalidateMock } },
        onboarding: { profile: { invalidate: invalidateMock }, timeZone: { invalidate: invalidateMock } },
        goals: { get: { invalidate: invalidateMock } },
        dashboard: { overview: { invalidate: invalidateMock }, today: { invalidate: invalidateMock } },
        reports: { weekly: { invalidate: invalidateMock }, bundle: { invalidate: invalidateMock }, periodBundle: { invalidate: invalidateMock } },
        meals: { list: { invalidate: invalidateMock }, dayTotals: { invalidate: invalidateMock } },
        exercises: { list: { invalidate: invalidateMock } },
        water: { list: { invalidate: invalidateMock } },
        professionals: {
          patientTimeZone: { invalidate: invalidateMock },
          patientDashboard: { invalidate: invalidateMock },
          patientPeriodBundle: { invalidate: invalidateMock },
        },
        mealSchedules: { list: { invalidate: invalidateMock } },
        whatsappPreferences: { annotatedImage: { invalidate: invalidateMock } },
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
        complete: { useMutation: (options: { onSuccess: (result: { recalculatedGoals: boolean }) => Promise<void> }) => ({
          isPending: false,
          mutate: async () => options.onSuccess({ recalculatedGoals: false }),
        }) },
      },
      whatsappPreferences: {
        annotatedImage: { useQuery: () => state.preference },
        updateAnnotatedImage: { useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: { enabled: boolean }) => {
            updatePreferenceMock(input);
            if (state.failPreferenceSave) throw new Error("Falha simulada ao salvar");
            return input;
          },
        }) },
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
  beforeEach(() => {
    state.location = "/settings";
    state.preference = { data: { enabled: false }, isLoading: false, isError: false };
    state.failPreferenceSave = false;
    toastErrorMock.mockReset();
    updatePreferenceMock.mockReset();
  });
  afterEach(cleanup);

  it("renderiza o controle acessível somente em Configurações > Perfil", async () => {
    const { default: OnboardingPage } = await import("./OnboardingPage");
    const { unmount } = render(React.createElement(OnboardingPage));

    expect(screen.getByRole("switch", { name: "Enviar imagem anotada pelo WhatsApp" }).getAttribute("aria-describedby")).toBe("send-annotated-image-description");
    expect(screen.getByText("Ao ativar, você receberá a foto com marcações dos alimentos identificados após a análise.")).toBeTruthy();
    unmount();

    state.location = "/onboarding";
    render(React.createElement(OnboardingPage));
    expect(screen.queryByRole("switch", { name: "Enviar imagem anotada pelo WhatsApp" })).toBeNull();
  });

  it.each([true, false])("carrega e apresenta o valor persistido %s", async enabled => {
    state.preference = { data: { enabled }, isLoading: false, isError: false };
    const { default: OnboardingPage } = await import("./OnboardingPage");
    render(React.createElement(OnboardingPage));

    await waitFor(() => expect(screen.getByRole("switch").getAttribute("data-state")).toBe(enabled ? "checked" : "unchecked"));
  });

  it("mantém o controle desabilitado durante carga e apresenta falha de leitura", async () => {
    state.preference = { data: undefined, isLoading: true, isError: false };
    const { default: OnboardingPage } = await import("./OnboardingPage");
    const { rerender } = render(React.createElement(OnboardingPage));
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(true);

    state.preference = { data: undefined, isLoading: false, isError: true };
    rerender(React.createElement(OnboardingPage));
    expect(screen.getByRole("alert").textContent).toContain("O envio permanece desabilitado");
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(true);
  });

  it("salva os dois estados e restaura o anterior quando o salvamento falha", async () => {
    const { default: OnboardingPage } = await import("./OnboardingPage");
    render(React.createElement(OnboardingPage));
    const toggle = screen.getByRole("switch");
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() => expect(updatePreferenceMock).toHaveBeenCalledWith({ enabled: true }));

    state.failPreferenceSave = true;
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Falha simulada ao salvar"));
    expect(toggle.getAttribute("data-state")).toBe("unchecked");
  });
});
