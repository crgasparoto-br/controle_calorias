// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const priorityInput = vi.fn();
const priorityOptions = vi.fn();
const portfolioOptions = vi.fn();
const priorityRefetch = vi.fn().mockResolvedValue(undefined);
const portfolioRefetch = vi.fn().mockResolvedValue(undefined);
const setLocation = vi.fn();
let currentLocation = "/professional";
let currentSearch = "";
let enabledResources: string[] = [];
let priorityState: any;
let portfolioState: any;

vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, setLocation],
}));
vi.mock("wouter/use-location", () => ({
  useSearch: () => currentSearch,
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  ProfessionalPageHeader: ({
    title,
    description,
    actions,
  }: {
    title: string;
    description: string;
    actions?: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </header>
  ),
  ProfessionalSplitLayout: ({
    children,
    aside,
  }: {
    children: React.ReactNode;
    aside?: React.ReactNode;
  }) => (
    <div>
      {children}
      {aside}
    </div>
  ),
  ProfessionalAsyncState: ({
    title,
    description,
    actionLabel = "Tentar novamente",
    onRetry,
  }: {
    title: string;
    description: string;
    actionLabel?: string;
    onRetry?: () => void;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      {onRetry ? <button onClick={onRetry}>{actionLabel}</button> : null}
    </section>
  ),
  ProfessionalLoadingState: ({ label }: { label: string }) => (
    <div>{label}</div>
  ),
  ProfessionalStatusBadge: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    professionalRecord: {
      settings: {
        entitlements: {
          useQuery: () => ({
            data: {
              allowed: true,
              enabledResources,
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
      },
      ai: {
        priorities: {
          useQuery: (input: unknown, options: unknown) => {
            priorityInput(input);
            priorityOptions(options);
            return { ...priorityState, refetch: priorityRefetch };
          },
        },
      },
    },
    nutrition: {
      professionals: {
        portfolio: {
          useQuery: (_input: unknown, options: unknown) => {
            portfolioOptions(options);
            return { ...portfolioState, refetch: portfolioRefetch };
          },
        },
      },
    },
  },
}));

function priority(patientId: number, type = "record_requires_review") {
  return {
    patientId,
    displayName: `Paciente ${patientId}`,
    alertCount: 2,
    highestSeverity: "urgent",
    primarySignal: {
      id: `primary-${patientId}`,
      type,
      label: "Registro que exige revisão",
      severity: "urgent",
      reason: `Motivo prioritário ${patientId}`,
      suggestedAction: `Ação prioritária ${patientId}`,
      period: { start: 100, end: 200 },
      updatedAt: 300,
    },
    signals: [
      {
        id: `primary-${patientId}`,
        type,
        label: "Registro que exige revisão",
        severity: "urgent",
      },
      {
        id: `secondary-${patientId}`,
        type: "goal_review_due",
        label: "Revisão de meta pendente",
        severity: "attention",
      },
    ],
    updatedAt: 300,
  };
}

beforeEach(() => {
  currentLocation = "/professional";
  currentSearch = "";
  enabledResources = ["professional_dashboard"];
  priorityState = { data: [], isLoading: false, isError: false };
  portfolioState = {
    data: {
      items: [{ patientUserId: 1 }],
      pagination: { total: 1 },
      summary: {
        active: 1,
        paused: 0,
        ended: 0,
        pendingRequests: 0,
        pendingReviews: 0,
        pendingWeighings: 0,
      },
    },
    isLoading: false,
    isError: false,
  };
  priorityInput.mockClear();
  priorityOptions.mockClear();
  portfolioOptions.mockClear();
  priorityRefetch.mockClear();
  portfolioRefetch.mockClear();
  setLocation.mockClear();
});

afterEach(cleanup);

describe("ProfessionalHome", () => {
  it("keeps dashboard-only access usable without starting optional queries", async () => {
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(
      screen.getByRole("heading", { name: "Prioridades de hoje" })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Prioridades operacionais indisponíveis",
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Resumo da carteira indisponível" })
    ).toBeTruthy();
    expect(priorityOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(portfolioOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("loads operational priorities without requiring AI assistance", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_operational_alerts",
      "professional_portfolio",
    ];
    priorityState.data = [priority(41)];
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(screen.getByText("Paciente 41")).toBeTruthy();
    expect(priorityInput).toHaveBeenCalledWith({ limit: 11, offset: 0 });
    expect(priorityOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
    expect(enabledResources).not.toContain("professional_ai_assistance");
  });

  it("keeps the main list at ten patients and offers the complete view", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_operational_alerts",
      "professional_portfolio",
    ];
    priorityState.data = Array.from({ length: 11 }, (_, index) =>
      priority(index + 1)
    );
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(priorityInput).toHaveBeenCalledWith({ limit: 11, offset: 0 });
    expect(screen.getByText("Paciente 10")).toBeTruthy();
    expect(screen.queryByText("Paciente 11")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Ver todas as prioridades/ })
    );
    expect(setLocation).toHaveBeenCalledWith("/professional?priorities=all");
  });

  it("paginates the complete view beyond one hundred patients from the search subscription", async () => {
    currentSearch = "priorities=all&page=3";
    enabledResources = [
      "professional_dashboard",
      "professional_operational_alerts",
      "professional_portfolio",
    ];
    priorityState.data = Array.from({ length: 51 }, (_, index) =>
      priority(index + 101)
    );
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(
      screen.getByRole("heading", { name: "Todas as prioridades" })
    ).toBeTruthy();
    expect(priorityInput).toHaveBeenCalledWith({ limit: 51, offset: 100 });
    expect(screen.getByText("Paciente 101")).toBeTruthy();
    expect(screen.getByText("Paciente 150")).toBeTruthy();
    expect(screen.queryByText("Paciente 151")).toBeNull();
    expect(screen.getByText("Página 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(setLocation).toHaveBeenCalledWith(
      "/professional?priorities=all&page=4"
    );
    fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
    expect(setLocation).toHaveBeenCalledWith(
      "/professional?priorities=all&page=2"
    );
  });

  it.each([
    ["goal_review_due", "Abrir metas", "/professional/patients/41/goals"],
    ["no_food_records", "Abrir relatório", "/professional/patients/41/reports"],
    [
      "record_requires_review",
      "Abrir relatório",
      "/professional/patients/41/reports",
    ],
    ["weigh_in_overdue", "Abrir mensagens", "/professional/patients/41/messages"],
    [
      "professional_request_overdue",
      "Abrir mensagens",
      "/professional/patients/41/messages",
    ],
  ])(
    "opens the contextual destination for %s",
    async (type, actionLabel, destination) => {
      enabledResources = [
        "professional_dashboard",
        "professional_operational_alerts",
        "professional_portfolio",
      ];
      priorityState.data = [priority(41, type)];
      const { default: ProfessionalHome } = await import("./ProfessionalHome");
      render(<ProfessionalHome />);

      fireEvent.click(screen.getByRole("button", { name: new RegExp(actionLabel) }));
      expect(setLocation).toHaveBeenCalledWith(destination);
    }
  );

  it("keeps the portfolio summary visible when priorities fail and retries locally", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_operational_alerts",
      "professional_portfolio",
    ];
    priorityState = { data: undefined, isLoading: false, isError: true };
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(
      screen.getByRole("heading", { name: "Não foi possível carregar as prioridades" })
    ).toBeTruthy();
    expect(screen.getByText("Ativos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(priorityRefetch).toHaveBeenCalledTimes(1);
    expect(portfolioRefetch).not.toHaveBeenCalled();
  });

  it("guides an empty portfolio to the access request flow", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_operational_alerts",
      "professional_portfolio",
    ];
    portfolioState.data = {
      items: [],
      pagination: { total: 0 },
      summary: {
        active: 0,
        paused: 0,
        ended: 0,
        pendingRequests: 0,
        pendingReviews: 0,
        pendingWeighings: 0,
      },
    };
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(
      screen.getByRole("heading", { name: "Sua carteira ainda está vazia" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Solicitar acesso" }));
    expect(setLocation).toHaveBeenCalledWith(
      "/professional/patients?request=new"
    );
  });
});
