// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn().mockResolvedValue(undefined);
const refetch = vi.fn().mockResolvedValue(undefined);
const invalidate = vi.fn().mockResolvedValue(undefined);
const cancel = vi.fn().mockResolvedValue(undefined);
const setData = vi.fn();
const fetchPatientTimeZone = vi.fn().mockResolvedValue({ timeZone: "America/Sao_Paulo" });
const mutate = vi.fn();

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ loading: false, user: { id: 1, name: "Nutricionista", professionalProfileActive: true }, refresh }) }));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: { goals: { get: { invalidate } }, reports: { invalidate }, professionals: { patientTimeZone: { invalidate, fetch: fetchPatientTimeZone }, patientDashboard: { invalidate }, patientPeriodBundle: { invalidate }, portfolio: { invalidate } } },
      professionalRecord: { get: { invalidate, cancel, setData } },
    }),
    nutrition: { professionals: {
      profile: { useQuery: () => ({ data: { active: true }, isLoading: false, isError: false, isSuccess: true, refetch }) },
      myAccesses: { useQuery: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, refetch }) },
      portfolio: { useQuery: () => ({ data: { items: [{ authorizationId: "access-1", patientUserId: 41, patientName: "Ana", patientEmail: "ana@example.com", authorizationStatus: "approved", trackingStatus: "active", requestedAt: Date.now(), lastFoodActivityAt: null, lastProfessionalInteractionAt: null, nextReviewAt: null, nextWeighingAt: null, pendingItems: 0 }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, summary: { active: 1, paused: 0, ended: 0, notStarted: 0, pendingRequests: 0, withoutRecentActivity: 1, pendingReviews: 0, pendingWeighings: 0 }, generatedAt: Date.now() }, isLoading: false, isError: false, refetch }) },
    } },
    professionalRecord: {
      messages: { patientList: { useInfiniteQuery: () => ({ data: { pages: [{ items: [], nextCursor: null }] }, isLoading: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }) } },
      get: { useQuery: () => ({ data: { patient: { id: 41, authorizationId: "access-1", authorizationStatus: "approved", trackingStatus: "active" }, latestAssessment: null, assessmentHistory: [], notes: [], guidances: [], timeline: [], pagination: { page: 1, pageSize: 20, totals: { assessments: 0, notes: 0, guidances: 0, timeline: 0 }, hasMore: false } }, isLoading: false, isError: false }) },
      saveAssessment: { useMutation: () => ({ mutate, isPending: false, isError: false }) },
      createNote: { useMutation: () => ({ mutate, isPending: false }) },
      createGuidance: { useMutation: () => ({ mutate, isPending: false }) },
      transitionTracking: { useMutation: () => ({ mutate, isPending: false, isError: false }) },
      patientGuidances: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
      officialGoal: {
        professionalState: { useQuery: () => ({ data: { current: null, history: [], reviewRequests: [], notifications: [] }, isLoading: false, isError: false, refetch }) },
        activate: { useMutation: () => ({ mutate, isPending: false }) },
        retryNotification: { useMutation: () => ({ mutate, isPending: false }) },
      },
    },
  },
}));
vi.mock("./components/ErrorBoundary", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./contexts/ThemeContext", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/tooltip", async importOriginal => { const actual = await importOriginal<typeof import("@/components/ui/tooltip")>(); return { ...actual, TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }; });
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("./components/NutritionGoalPreviewValidityBridge", () => ({ default: () => null }));
vi.mock("./components/NutritionGoalReportInvalidator", () => ({ default: () => null }));
vi.mock("./components/PatientGoalSuggestionsEmbed", () => ({ default: () => null }));
vi.mock("./components/PatientProfessionalGuidancesEmbed", () => ({ default: () => null }));
vi.mock("./components/ProfessionalAnalyzeTabBridge", () => ({ default: () => null }));
vi.mock("./components/ProfessionalGoalExceptionSuggestionsEmbed", () => ({ default: () => null }));
vi.mock("./components/ProfileWhatsappGreetingVisibility", () => ({ default: () => null }));

function Fixture({ name }: { name: string }) { return <h1>{name}</h1>; }
vi.mock("@/pages/ProfessionalReportsPage", () => ({ default: () => <Fixture name="Experiência profissional legada" /> }));
vi.mock("@/pages/AdminPage", () => ({ default: () => <Fixture name="AdminPage" /> }));
vi.mock("@/pages/ChannelsPage", () => ({ default: () => <Fixture name="ChannelsPage" /> }));
vi.mock("@/pages/FoodsPage", () => ({ default: () => <Fixture name="FoodsPage" /> }));
vi.mock("@/pages/GoalsPage", () => ({ default: () => <Fixture name="GoalsPage" /> }));
vi.mock("@/pages/HealthIntegrationsPage", () => ({ default: () => <Fixture name="HealthIntegrationsPage" /> }));
vi.mock("@/pages/Home", () => ({ default: () => <Fixture name="Home" /> }));
vi.mock("@/pages/LogMealPage", () => ({ default: () => <Fixture name="LogMealPage" /> }));
vi.mock("@/pages/LoginPage", () => ({ default: () => <Fixture name="LoginPage" /> }));
vi.mock("@/pages/NotFound", () => ({ default: () => <Fixture name="NotFound" /> }));
vi.mock("@/pages/OnboardingPage", () => ({ default: () => <Fixture name="OnboardingPage" /> }));
vi.mock("@/pages/QuickEditExercisePage", () => ({ default: () => <Fixture name="QuickEditExercisePage" /> }));
vi.mock("@/pages/QuickEditMealPage", () => ({ default: () => <Fixture name="QuickEditMealPage" /> }));
vi.mock("@/pages/RegisterPage", () => ({ default: () => <Fixture name="RegisterPage" /> }));
vi.mock("@/pages/RegisteredMealsPage", () => ({ default: () => <Fixture name="RegisteredMealsPage" /> }));
vi.mock("@/pages/ReportsPage", () => ({ default: () => <Fixture name="ReportsPage" /> }));
vi.mock("@/pages/SyncedHealthDataPage", () => ({ default: () => <Fixture name="SyncedHealthDataPage" /> }));
vi.mock("@/pages/WhatsappOnboardingPage", () => ({ default: () => <Fixture name="WhatsappOnboardingPage" /> }));

afterEach(cleanup);
beforeEach(() => { refresh.mockClear(); refetch.mockClear(); invalidate.mockClear(); cancel.mockClear(); setData.mockClear(); fetchPatientTimeZone.mockClear(); fetchPatientTimeZone.mockResolvedValue({ timeZone: "America/Sao_Paulo" }); window.history.replaceState({}, "", "/professional/reports"); });

describe("App professional navigation", () => {
  it("loads a professional deep link through the real router", async () => { const { default: App } = await import("./App"); render(<App />); expect(await screen.findByRole("heading", { name: "Relatórios profissionais" })).toBeTruthy(); expect(screen.getByText("Contexto profissional")).toBeTruthy(); });
  it("keeps the legacy route reachable and returns to the personal context", async () => { const { default: App } = await import("./App"); render(<App />); fireEvent.click(await screen.findByRole("button", { name: "Experiência legada" })); expect(await screen.findByRole("heading", { name: "Experiência profissional legada" })).toBeTruthy(); window.history.pushState({}, "", "/professional"); window.dispatchEvent(new PopStateEvent("popstate")); await screen.findByRole("heading", { name: "Início profissional" }); fireEvent.click(screen.getByRole("button", { name: "Minha alimentação" })); await waitFor(() => expect(window.location.pathname).toBe("/today")); expect(await screen.findByRole("heading", { name: "Home" })).toBeTruthy(); });
  it("revalidates backend authorization before opening a patient context", async () => { window.history.replaceState({}, "", "/professional/patients"); const { default: App } = await import("./App"); render(<App />); fireEvent.click(await screen.findByRole("button", { name: "Abrir paciente" })); await waitFor(() => expect(fetchPatientTimeZone).toHaveBeenCalledWith({ patientId: 41, weekOffset: 0 })); await waitFor(() => expect(window.location.pathname).toBe("/professional/follow-up")); });
  it("does not open stale cached access when backend revalidation fails", async () => { fetchPatientTimeZone.mockRejectedValueOnce(new Error("revoked")); window.history.replaceState({}, "", "/professional/patients"); const { default: App } = await import("./App"); render(<App />); fireEvent.click(await screen.findByRole("button", { name: "Abrir paciente" })); expect(await screen.findByText("O acesso a este paciente não está mais disponível. A carteira foi atualizada.")).toBeTruthy(); expect(window.location.pathname).toBe("/professional/patients"); expect(refetch).toHaveBeenCalled(); });
});
