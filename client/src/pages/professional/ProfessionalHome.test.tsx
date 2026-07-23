// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const priorityOptions = vi.fn();
const portfolioOptions = vi.fn();
const setLocation = vi.fn();
let enabledResources: string[] = [];

vi.mock("wouter", () => ({
  useLocation: () => ["/professional", setLocation],
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
  }: {
    title: string;
    description: string;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
    </section>
  ),
  ProfessionalLoadingState: ({ label }: { label: string }) => (
    <div>{label}</div>
  ),
  ProfessionalStatusBadge: () => null,
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
          useQuery: (_input: unknown, options: unknown) => {
            priorityOptions(options);
            return {
              data: [],
              isLoading: false,
              isError: false,
              refetch: vi.fn(),
            };
          },
        },
      },
    },
    nutrition: {
      professionals: {
        portfolio: {
          useQuery: (_input: unknown, options: unknown) => {
            portfolioOptions(options);
            return {
              data: {
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
              refetch: vi.fn(),
            };
          },
        },
      },
    },
  },
}));

beforeEach(() => {
  enabledResources = ["professional_dashboard"];
  priorityOptions.mockClear();
  portfolioOptions.mockClear();
  setLocation.mockClear();
});

afterEach(cleanup);

describe("ProfessionalHome entitlement composition", () => {
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

  it("loads the optional dashboard panels only when their resources are enabled", async () => {
    enabledResources = [
      "professional_dashboard",
      "professional_ai_assistance",
      "professional_portfolio",
    ];
    const { default: ProfessionalHome } = await import("./ProfessionalHome");
    render(<ProfessionalHome />);

    expect(
      screen.getByRole("heading", { name: "Nenhuma prioridade operacional aberta" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver carteira" })).toBeTruthy();
    expect(screen.getByText("Ativos")).toBeTruthy();
    expect(priorityOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
    expect(portfolioOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });
});
