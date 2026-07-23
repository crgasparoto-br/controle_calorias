// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const entitlementState = {
  allowed: true,
  enabledResources: [
    "professional_dashboard",
    "professional_portfolio",
    "professional_record",
    "professional_messages",
    "professional_reports",
    "professional_settings",
  ],
};
const refetch = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    professionalRecord: {
      settings: {
        entitlements: {
          useQuery: () => ({
            data: {
              allowed: entitlementState.allowed,
              enabledResources: entitlementState.enabledResources,
              planName: entitlementState.allowed ? "Acesso aberto" : "Sem acesso",
            },
            isLoading: false,
            isError: false,
            refetch,
          }),
        },
      },
    },
  },
}));

vi.mock("./components/ErrorBoundary", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./contexts/ThemeContext", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

for (const path of [
  "./components/NutritionGoalPreviewValidityBridge",
  "./components/NutritionGoalReportInvalidator",
  "./components/PatientGoalSuggestionsEmbed",
  "./components/PatientProfessionalGuidancesEmbed",
  "./components/PatientProfessionalMessagesEmbed",
  "./components/PatientProfessionalProfilesEmbed",
  "./components/ProfileWhatsappGreetingVisibility",
]) {
  vi.doMock(path, () => ({ default: () => null }));
}

function Fixture({ name }: { name: string }) {
  return <h1>{name}</h1>;
}

vi.mock("@/pages/ProfessionalAreaPage", () => ({
  default: () => <Fixture name="Área Profissional canônica" />,
}));
vi.mock("@/pages/ProfessionalSettingsPage", () => ({
  default: () => <Fixture name="Configurações profissionais" />,
}));
vi.mock("@/pages/SettingsPageRouter", () => ({
  default: () => <Fixture name="Configurações pessoais" />,
}));

for (const [path, name] of [
  ["@/pages/AdminPage", "AdminPage"],
  ["@/pages/ChannelsPage", "ChannelsPage"],
  ["@/pages/FoodsPage", "FoodsPage"],
  ["@/pages/GoalsPage", "GoalsPage"],
  ["@/pages/HealthIntegrationsPage", "HealthIntegrationsPage"],
  ["@/pages/Home", "Home"],
  ["@/pages/LogMealPage", "LogMealPage"],
  ["@/pages/LoginPage", "LoginPage"],
  ["@/pages/NotFound", "NotFound"],
  ["@/pages/OnboardingPage", "OnboardingPage"],
  ["@/pages/QuickEditExercisePage", "QuickEditExercisePage"],
  ["@/pages/QuickEditMealPage", "QuickEditMealPage"],
  ["@/pages/RegisterPage", "RegisterPage"],
  ["@/pages/RegisteredMealsPage", "RegisteredMealsPage"],
  ["@/pages/ReportsPage", "ReportsPage"],
  ["@/pages/SyncedHealthDataPage", "SyncedHealthDataPage"],
  ["@/pages/WhatsappOnboardingPage", "WhatsappOnboardingPage"],
] as const) {
  vi.doMock(path, () => ({ default: () => <Fixture name={name} /> }));
}

afterEach(cleanup);

beforeEach(() => {
  entitlementState.allowed = true;
  entitlementState.enabledResources = [
    "professional_dashboard",
    "professional_portfolio",
    "professional_record",
    "professional_messages",
    "professional_reports",
    "professional_settings",
  ];
  refetch.mockClear();
  window.history.replaceState({}, "", "/professional/reports");
});

describe("App professional navigation", () => {
  it("loads aggregate professional deep links through the canonical area", async () => {
    const { default: App } = await import("./App");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Área Profissional canônica" })
    ).toBeTruthy();
  });

  it("loads patient-scoped deep links through the canonical area", async () => {
    window.history.replaceState({}, "", "/professional/patients/41/messages");
    const { default: App } = await import("./App");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Área Profissional canônica" })
    ).toBeTruthy();
  });

  it("allows an individual report with only the reports entitlement", async () => {
    entitlementState.enabledResources = ["professional_reports"];
    window.history.replaceState({}, "", "/professional/patients/41/reports");
    const { default: App } = await import("./App");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Área Profissional canônica" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Recurso profissional indisponível" })
    ).toBeNull();
  });

  it("allows an individual conversation with only the messages entitlement", async () => {
    entitlementState.enabledResources = ["professional_messages"];
    window.history.replaceState({}, "", "/professional/patients/41/messages");
    const { default: App } = await import("./App");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Área Profissional canônica" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Recurso profissional indisponível" })
    ).toBeNull();
  });

  it("allows patient goals with the record entitlement", async () => {
    entitlementState.enabledResources = ["professional_record"];
    window.history.replaceState({}, "", "/professional/patients/41/goals");
    const { default: App } = await import("./App");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Área Profissional canônica" })
    ).toBeTruthy();
  });

  it("does not substitute a neighboring entitlement for the route entitlement", async () => {
    entitlementState.enabledResources = ["professional_record"];
    window.history.replaceState({}, "", "/professional/patients/41/reports");
    const { default: App } = await import("./App");
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Recurso profissional indisponível",
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Área Profissional canônica" })
    ).toBeNull();
  });

  it("routes professional settings to the dedicated screen", async () => {
    window.history.replaceState({}, "", "/professional/settings");
    const { default: App } = await import("./App");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Configurações profissionais" })
    ).toBeTruthy();
  });

  it("redirects the retired follow-up bookmark to the portfolio", async () => {
    window.history.replaceState({}, "", "/professional/follow-up");
    const { default: App } = await import("./App");
    render(<App />);

    await waitFor(() =>
      expect(window.location.pathname).toBe("/professional/patients")
    );
    expect(
      await screen.findByRole("heading", { name: "Área Profissional canônica" })
    ).toBeTruthy();
  });

  it("blocks professional routes when the entitlement is unavailable", async () => {
    entitlementState.allowed = false;
    entitlementState.enabledResources = [];
    const { default: App } = await import("./App");
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Recurso profissional indisponível",
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Área Profissional canônica" })
    ).toBeNull();
  });
});
