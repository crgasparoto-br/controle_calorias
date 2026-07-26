// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let location = "/professional/patients/41/reports";
let recordData: any = undefined;
const setLocation = vi.fn();
const getQuery = vi.fn();
const invalidateRecord = vi.fn(async () => undefined);
const invalidatePortfolio = vi.fn(async () => undefined);

const mutation = () => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
});

vi.mock("wouter", () => ({
  useLocation: () => [location, setLocation],
}));

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({
    selectedPatient: {
      patientId: 41,
      displayName: "Paciente autorizado",
      authorizationStatus: "approved",
      lastActivityAt: Date.UTC(2026, 6, 24, 15, 30),
      nextReviewAt: Date.UTC(2026, 7, 5, 12),
      trackingStatus: "active",
    },
  }),
}));

vi.mock("@/components/ProfessionalMessagesPanel", () => ({
  default: () => <div>Conversa individual carregada</div>,
}));

vi.mock("@/components/ProfessionalReportsWorkspace", () => ({
  default: () => <div>Relatório individual carregado</div>,
}));

vi.mock("@/components/ProfessionalOfficialGoalCard", () => ({
  default: () => <div>Metas profissionais</div>,
}));

vi.mock("@/components/ProfessionalOperationalAlertsPanel", () => ({
  default: () => <div>Pendências operacionais</div>,
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalAsyncState: ({ title }: { title: string }) => <div>{title}</div>,
  ProfessionalLoadingState: ({ label }: { label: string }) => (
    <div>{label}</div>
  ),
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  ProfessionalPageHeader: ({
    title,
    actions,
  }: {
    title: string;
    actions?: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
  ProfessionalPatientHeader: ({
    actions,
    lastActivityAt,
    nextReviewAt,
    trackingStatus,
  }: {
    actions?: React.ReactNode;
    lastActivityAt?: number | null;
    nextReviewAt?: number | null;
    trackingStatus: string;
  }) => (
    <div>
      <span>Estado do paciente: {trackingStatus}</span>
      <span>Última atividade estável: {lastActivityAt}</span>
      <span>Próxima revisão estável: {nextReviewAt}</span>
      {actions}
    </div>
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
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      professionalRecord: { get: { invalidate: invalidateRecord } },
      nutrition: {
        professionals: { portfolio: { invalidate: invalidatePortfolio } },
      },
    }),
    professionalRecord: {
      get: {
        useQuery: (input: unknown, options: unknown) => {
          getQuery(input, options);
          return {
            data: recordData,
            isLoading: false,
            isError: false,
            error: null,
            refetch: vi.fn(async () => undefined),
          };
        },
      },
      saveAssessment: { useMutation: mutation },
      createNote: { useMutation: mutation },
      createGuidance: { useMutation: mutation },
      transitionTracking: { useMutation: mutation },
    },
  },
}));

function recordFixture() {
  return {
    patient: {
      trackingStatus: "active",
      authorizationId: "authorization-41",
    },
    latestAssessment: null,
    assessmentHistory: [
      {
        id: "assessment-1",
        version: 1,
        objective: "Objetivo",
        assessedAt: Date.UTC(2026, 6, 20, 12),
        authorName: "Nutricionista Teste",
      },
    ],
    notes: [
      {
        id: "note-1",
        content: "Conteúdo privado",
        createdAt: Date.UTC(2026, 6, 21, 12),
        authorName: "Nutricionista Teste",
      },
    ],
    guidances: [],
    timeline: [
      {
        id: "history-1",
        eventType: "private_note_created",
        occurredAt: Date.UTC(2026, 6, 21, 12),
      },
      {
        id: "history-2",
        eventType: "unknown_internal_event",
        occurredAt: Date.UTC(2026, 6, 20, 12),
      },
    ],
    pagination: { hasMore: false },
  };
}

beforeEach(() => {
  location = "/professional/patients/41/reports";
  recordData = undefined;
  setLocation.mockReset();
  getQuery.mockReset();
});

afterEach(cleanup);

describe("ProfessionalPatientWorkspace access isolation", () => {
  it("does not require the professional record to render an individual report", async () => {
    const { default: ProfessionalPatientWorkspace } = await import(
      "./ProfessionalPatientWorkspace"
    );
    render(<ProfessionalPatientWorkspace />);

    expect(screen.getByText("Relatório individual carregado")).toBeTruthy();
    expect(screen.getByText("Estado do paciente: active")).toBeTruthy();
    expect(
      screen.getByText(
        `Última atividade estável: ${Date.UTC(2026, 6, 24, 15, 30)}`
      )
    ).toBeTruthy();
    expect(
      screen.getByText(`Próxima revisão estável: ${Date.UTC(2026, 7, 5, 12)}`)
    ).toBeTruthy();
    expect(getQuery).toHaveBeenCalledWith(
      { patientId: 41, page: 1, pageSize: 20 },
      expect.objectContaining({ enabled: false, refetchInterval: false })
    );
  });

  it("does not require the professional record to render an individual conversation", async () => {
    location = "/professional/patients/41/messages";
    const { default: ProfessionalPatientWorkspace } = await import(
      "./ProfessionalPatientWorkspace"
    );
    render(<ProfessionalPatientWorkspace />);

    expect(screen.getByText("Conversa individual carregada")).toBeTruthy();
    expect(
      screen.getByText(
        `Última atividade estável: ${Date.UTC(2026, 6, 24, 15, 30)}`
      )
    ).toBeTruthy();
    expect(
      screen.getByText(`Próxima revisão estável: ${Date.UTC(2026, 7, 5, 12)}`)
    ).toBeTruthy();
    expect(getQuery).toHaveBeenCalledWith(
      { patientId: 41, page: 1, pageSize: 20 },
      expect.objectContaining({ enabled: false, refetchInterval: false })
    );
  });

  it("shows authorship for private notes and assessment versions", async () => {
    recordData = recordFixture();
    location = "/professional/patients/41/notes";
    const { default: ProfessionalPatientWorkspace } = await import(
      "./ProfessionalPatientWorkspace"
    );
    const view = render(<ProfessionalPatientWorkspace />);

    expect(screen.getByText(/Nutricionista Teste ·/)).toBeTruthy();

    location = "/professional/patients/41/assessment";
    view.rerender(<ProfessionalPatientWorkspace />);
    expect(screen.getByText(/Nutricionista Teste ·/)).toBeTruthy();
  });

  it("maps history event identifiers to safe domain labels", async () => {
    recordData = recordFixture();
    location = "/professional/patients/41/history";
    const { default: ProfessionalPatientWorkspace } = await import(
      "./ProfessionalPatientWorkspace"
    );
    render(<ProfessionalPatientWorkspace />);

    expect(screen.getByText("Anotação privada registrada")).toBeTruthy();
    expect(screen.getByText("Evento profissional registrado")).toBeTruthy();
    expect(screen.queryByText("private_note_created")).toBeNull();
    expect(screen.queryByText("unknown_internal_event")).toBeNull();
  });
});
