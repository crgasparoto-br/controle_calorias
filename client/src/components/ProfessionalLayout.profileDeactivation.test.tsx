// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllProfessionalPatientDraftSnapshots,
  readProfessionalPatientDraftSnapshot,
  storeProfessionalPatientDraftSnapshot,
} from "@/lib/professionalPatientDraftStore";

const mocks = vi.hoisted(() => ({
  location: "/professional/patients/10",
  profileActive: true,
  removeQueries: vi.fn(),
  setLocation: vi.fn(),
}));

const cancel = vi.fn(async () => undefined);
const stableUtils = {
  nutrition: {
    professionals: {
      patientTimeZone: { cancel },
      patientDashboard: { cancel },
      patientPeriodBundle: { cancel },
    },
  },
  professionalRecord: {
    context: { cancel },
    get: { cancel },
    messages: { list: { cancel } },
    operationalAlerts: { list: { cancel } },
    ai: { priorities: { cancel } },
    officialGoal: { professionalState: { cancel } },
  },
};

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    refresh: vi.fn(async () => undefined),
    user: { id: 42, professionalProfileActive: true },
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => [mocks.location, mocks.setLocation] as const,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    removeQueries: mocks.removeQueries,
    getQueryCache: () => ({ subscribe: () => () => undefined }),
    getMutationCache: () => ({ subscribe: () => () => undefined }),
  }),
}));

vi.mock("@/hooks/useProfessionalAccessRevocationStream", () => ({
  useProfessionalAccessRevocationStream: () => undefined,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => stableUtils,
    nutrition: {
      professionals: {
        profile: {
          useQuery: () => ({
            data: { active: mocks.profileActive },
            error: null,
            isError: false,
            isFetchedAfterMount: true,
            isFetching: false,
            isSuccess: true,
            refetch: vi.fn(async () => undefined),
          }),
        },
      },
    },
    professionalRecord: {
      context: {
        useQuery: () => ({
          data: {
            authorizationId: "access-10",
            authorizationStatus: "approved",
            displayName: "Ana",
            patientId: 10,
            trackingStatus: "active",
          },
          error: null,
          isError: false,
          isFetchedAfterMount: true,
          isFetching: false,
          isSuccess: true,
          refetch: vi.fn(async () => undefined),
        }),
      },
    },
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => <aside>{children}</aside>,
  SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>Menu</button>
  ),
}));

vi.mock("lucide-react", () =>
  new Proxy(
    {},
    {
      get: () => () => <span aria-hidden="true" />,
    }
  )
);

vi.mock("./DashboardLayoutSkeleton", () => ({
  DashboardLayoutSkeleton: () => <div>Carregando</div>,
}));

import ProfessionalLayout from "./ProfessionalLayout";

describe("ProfessionalLayout profile deactivation", () => {
  beforeEach(() => {
    clearAllProfessionalPatientDraftSnapshots();
    cancel.mockClear();
    mocks.location = "/professional/patients/10";
    mocks.profileActive = true;
    mocks.removeQueries.mockClear();
    mocks.setLocation.mockClear();
  });

  afterEach(cleanup);

  it("remove conteúdo, caches e rascunhos quando detecta perfil inativo", async () => {
    const draftScope = { patientId: 10, authorizationId: "access-10" };
    storeProfessionalPatientDraftSnapshot(draftScope, {
      note: "rascunho sensível",
    });
    const view = render(
      <ProfessionalLayout>
        <div>conteúdo do paciente</div>
      </ProfessionalLayout>
    );
    await waitFor(() =>
      expect(screen.getByText("conteúdo do paciente")).toBeTruthy()
    );

    mocks.profileActive = false;
    view.rerender(
      <ProfessionalLayout>
        <div>conteúdo do paciente</div>
      </ProfessionalLayout>
    );

    expect(screen.getByText("Área Profissional indisponível")).toBeTruthy();
    expect(screen.queryByText("conteúdo do paciente")).toBeNull();
    await waitFor(() => expect(mocks.removeQueries).toHaveBeenCalled());
    expect(
      readProfessionalPatientDraftSnapshot(draftScope, () => ({ note: "" }))
    ).toEqual({ note: "" });
  });
});
