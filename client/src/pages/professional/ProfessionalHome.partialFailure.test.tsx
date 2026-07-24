// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const priorityRefetch = vi.fn().mockResolvedValue(undefined);
const portfolioRefetch = vi.fn().mockResolvedValue(undefined);

vi.mock("wouter", () => ({
  useLocation: () => ["/professional", vi.fn()],
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
    onRetry,
  }: {
    title: string;
    description: string;
    onRetry?: () => void;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      {onRetry ? <button onClick={onRetry}>Tentar novamente</button> : null}
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
              enabledResources: [
                "professional_dashboard",
                "professional_operational_alerts",
                "professional_portfolio",
              ],
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
      },
      ai: {
        priorities: {
          useQuery: () => ({
            data: [
              {
                patientId: 41,
                displayName: "Ana",
                alertCount: 1,
                highestSeverity: "urgent",
                primarySignal: {
                  id: "signal-1",
                  type: "record_requires_review",
                  label: "Registro que exige revisão",
                  severity: "urgent",
                  reason: "Registro marcado para revisão.",
                  suggestedAction: "Conferir o registro.",
                  period: { start: 100, end: 200 },
                  updatedAt: 300,
                },
                signals: [
                  {
                    id: "signal-1",
                    type: "record_requires_review",
                    label: "Registro que exige revisão",
                    severity: "urgent",
                  },
                ],
                updatedAt: 300,
              },
            ],
            isLoading: false,
            isError: false,
            refetch: priorityRefetch,
          }),
        },
      },
    },
    nutrition: {
      professionals: {
        portfolio: {
          useQuery: () => ({
            data: undefined,
            isLoading: false,
            isError: true,
            refetch: portfolioRefetch,
          }),
        },
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  priorityRefetch.mockClear();
  portfolioRefetch.mockClear();
});

describe("ProfessionalHome partial failure isolation", () => {
  it("keeps loaded priorities visible when the portfolio summary fails", async () => {
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("Registro marcado para revisão.")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Não foi possível carregar o resumo" })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(portfolioRefetch).toHaveBeenCalledTimes(1);
    expect(priorityRefetch).not.toHaveBeenCalled();
  });
});
