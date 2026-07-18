// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout from "@/components/DashboardLayout";

const { enabledQueryCalls } = vi.hoisted(() => ({
  enabledQueryCalls: [] as string[],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    user: { id: 1, name: "Gaspa", role: "user" },
    logout: vi.fn(),
  }),
}));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("./components/ErrorBoundary", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./contexts/ThemeContext", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/ui/tooltip", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@/components/ui/tooltip")>();
  return {
    ...actual,
    TooltipProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

vi.mock("@/lib/trpc", () => {
  const query = (name: string) => ({
    useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
      if (options?.enabled) enabledQueryCalls.push(name);
      return { data: undefined, isLoading: false, isError: false, error: null };
    },
  });
  return {
    trpc: {
      nutrition: {
        goals: { get: query("goals.get") },
        reports: { periodBundle: query("reports.periodBundle") },
        dashboard: { today: query("dashboard.today") },
      },
    },
  };
});

vi.mock("./components/NutritionGoalReportInvalidator", () => ({
  default: () => null,
}));
vi.mock("./components/PatientGoalSuggestionsEmbed", () => ({
  default: () => null,
}));
vi.mock("./components/ProfessionalAnalyzeTabBridge", () => ({
  default: () => null,
}));
vi.mock("./components/ProfessionalGoalExceptionSuggestionsEmbed", () => ({
  default: () => null,
}));
vi.mock("./components/ProfileWhatsappGreetingVisibility", () => ({
  default: () => null,
}));

function RoutedPage({ name }: { name: string }) {
  return (
    <DashboardLayout>
      <h1>{name}</h1>
    </DashboardLayout>
  );
}

function GoalsFixture() {
  return (
    <DashboardLayout>
      <input id="goal-start-date" value="2026-07-13" readOnly />
      <section data-nutrition-goal-week-preview="true">
        <h3>Prévia da semana</h3>
        {Array.from({ length: 7 }, (_, index) => (
          <div className="rounded-2xl" key={index}>
            <p>Dia {index + 1}</p>
            <span>{String(13 + index).padStart(2, "0")}/07/2026</span>
            <p className="min-h-10">Usa a meta padrão.</p>
            <p>2.200 kcal</p>
            <p>160 g proteína</p>
            <p>240 g carbo</p>
            <p>70 g gordura</p>
          </div>
        ))}
        <p>Total da Semana</p>
      </section>
    </DashboardLayout>
  );
}

vi.mock("@/pages/GoalsPage", () => ({ default: GoalsFixture }));
vi.mock("@/pages/Home", () => ({
  default: () => <RoutedPage name="Página Hoje" />,
}));
vi.mock("@/pages/LogMealPage", () => ({
  default: () => <RoutedPage name="Página Registrar" />,
}));
vi.mock("@/pages/RegisteredMealsPage", () => ({
  default: () => <RoutedPage name="Página Registros" />,
}));
vi.mock("@/pages/ReportsPage", () => ({
  default: () => <RoutedPage name="Página Relatórios" />,
}));

vi.mock("@/pages/AdminPage", () => ({
  default: () => <RoutedPage name="AdminPage" />,
}));
vi.mock("@/pages/ChannelsPage", () => ({
  default: () => <RoutedPage name="ChannelsPage" />,
}));
vi.mock("@/pages/FoodsPage", () => ({
  default: () => <RoutedPage name="FoodsPage" />,
}));
vi.mock("@/pages/HealthIntegrationsPage", () => ({
  default: () => <RoutedPage name="HealthIntegrationsPage" />,
}));
vi.mock("@/pages/LoginPage", () => ({
  default: () => <RoutedPage name="LoginPage" />,
}));
vi.mock("@/pages/NotFound", () => ({
  default: () => <RoutedPage name="NotFound" />,
}));
vi.mock("@/pages/OnboardingPage", () => ({
  default: () => <RoutedPage name="OnboardingPage" />,
}));
vi.mock("@/pages/ProfessionalReportsPage", () => ({
  default: () => <RoutedPage name="ProfessionalReportsPage" />,
}));
vi.mock("@/pages/QuickEditExercisePage", () => ({
  default: () => <RoutedPage name="QuickEditExercisePage" />,
}));
vi.mock("@/pages/QuickEditMealPage", () => ({
  default: () => <RoutedPage name="QuickEditMealPage" />,
}));
vi.mock("@/pages/RegisterPage", () => ({
  default: () => <RoutedPage name="RegisterPage" />,
}));
vi.mock("@/pages/SyncedHealthDataPage", () => ({
  default: () => <RoutedPage name="SyncedHealthDataPage" />,
}));
vi.mock("@/pages/WhatsappOnboardingPage", () => ({
  default: () => <RoutedPage name="WhatsappOnboardingPage" />,
}));

describe("App navigation lifecycle from Goals", () => {
  beforeEach(() => {
    enabledQueryCalls.length = 0;
    window.history.replaceState({}, "", "/goals");
  });

  it("entra e sai repetidamente pelo roteador real sem acumular o host da prévia", async () => {
    const { default: App } = await import("./App");
    const view = render(<App />);

    await waitFor(() =>
      expect(
        document.querySelectorAll(
          "[data-nutrition-goal-preview-validity-bridge='true']"
        )
      ).toHaveLength(1)
    );

    for (const [menuLabel, pageTitle] of [
      ["Hoje", "Página Hoje"],
      ["Registrar", "Página Registrar"],
      ["Registros", "Página Registros"],
      ["Relatórios", "Página Relatórios"],
    ]) {
      const item = screen
        .getAllByText(menuLabel)
        .find(element => element.closest("[data-sidebar='menu-button']"));
      fireEvent.click(item!.closest("button")!);
      await screen.findByRole("heading", { name: pageTitle });
      expect(
        document.querySelector(
          "[data-nutrition-goal-preview-validity-bridge='true']"
        )
      ).toBeNull();
      const queryCallsAfterExit = enabledQueryCalls.length;
      document.body.appendChild(document.createElement("div"));
      await Promise.resolve();
      expect(enabledQueryCalls).toHaveLength(queryCallsAfterExit);

      const goalsItem = screen.getByText("Metas nutricionais");
      fireEvent.click(goalsItem.closest("button")!);
      await waitFor(() =>
        expect(
          document.querySelectorAll(
            "[data-nutrition-goal-preview-validity-bridge='true']"
          )
        ).toHaveLength(1)
      );
    }

    expect(window.location.pathname).toBe("/goals");
    expect(
      enabledQueryCalls.filter(name => name === "goals.get").length
    ).toBeLessThanOrEqual(10);
    view.unmount();
    await Promise.resolve();
  });
});
