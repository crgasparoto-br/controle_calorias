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
let enabledResources: string[] = [];
let priorityState: any;
let portfolioState: any;

vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, setLocation],
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
  it("keeps a dashboard-only access usable without starting optional queries", async () => {
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(
      screen.getByRole("heading", { name: "Prioridades de hoje" })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Prioridades assistidas indisponíveis",
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Resumo da carteira indisponível" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver carteira" })).toBeNull();
    expect(priorityOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(portfolioOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("loads optional panels and operational shortcuts only for enabled resources", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_ai_assistance",
      "professional_portfolio",
      "professional_messages",
      "professional_reports",
    ];
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(
      screen.getByRole("heading", { name: "Nenhuma prioridade operacional aberta" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver carteira" })).toBeTruthy();
    expect(screen.getByText("Ativos")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Atalhos operacionais" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Abrir mensagens/ })).toBeTruthy();
    expect(priorityOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
    expect(portfolioOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });

  it("keeps the main list at ten patients and offers the complete view", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_ai_assistance",
      "professional_portfolio",
    ];
    priorityState.data = Array.from({ length: 11 }, (_, index) =>
      priority(index + 1)
    );
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(priorityInput).toHaveBeenCalledWith({ limit: 11 });
    expect(screen.getByText("Paciente 10")).toBeTruthy();
    expect(screen.queryByText("Paciente 11")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Ver todas as prioridades/ })
    );
    expect(setLocation).toHaveBeenCalledWith("/professional?priorities=all");
  });

  it("uses the primary signal for reason, action and contextual destination", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_ai_assistance",
      "professional_portfolio",
    ];
    priorityState.data = [priority(41, "record_requires_review")];
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(screen.getByText("Motivo prioritário 41")).toBeTruthy();
    expect(screen.getByText(/Ação prioritária 41/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Abrir relatório/ }));
    expect(setLocation).toHaveBeenCalledWith(
      "/professional/patients/41/reports"
    );
  });

  it("opens a complete priority view and returns to the first ten", async () => {
    currentLocation = "/professional?priorities=all";
    enabledResources = [
      "professional_dashboard",
      "professional_ai_assistance",
      "professional_portfolio",
    ];
    priorityState.data = Array.from({ length: 12 }, (_, index) =>
      priority(index + 1)
    );
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(priorityInput).toHaveBeenCalledWith({ limit: 100 });
    expect(screen.getByText("Paciente 12")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Voltar às dez primeiras/ })
    );
    expect(setLocation).toHaveBeenCalledWith("/professional");
  });

  it("keeps the portfolio summary visible when priorities fail and retries locally", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_ai_assistance",
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
      "professional_ai_assistance",
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

  it("explains pending weigh-ins without linking to an unrelated portfolio filter", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_ai_assistance",
      "professional_portfolio",
    ];
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(screen.getByText("Pesagens pendentes")).toBeTruthy();
    expect(
      screen.getByText(/Solicitações de pesagem vencidas/)
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Pesagens pendentes/ })
    ).toBeNull();
  });
});
