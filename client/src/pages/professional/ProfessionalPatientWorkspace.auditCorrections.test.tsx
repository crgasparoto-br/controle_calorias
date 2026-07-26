// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let location = "/professional/patients/41/assessment";
let selectedPatientId = 41;
let recordData: any;
const setLocation = vi.fn();
const getQuery = vi.fn();

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
      patientId: selectedPatientId,
      displayName: `Paciente ${selectedPatientId}`,
      authorizationStatus: "approved",
      lastActivityAt: null,
      nextReviewAt: null,
      trackingStatus: "active",
    },
  }),
}));

vi.mock("@/components/ProfessionalMessagesPanel", () => ({
  default: () => <div>Mensagens</div>,
}));
vi.mock("@/components/ProfessionalOfficialGoalCard", () => ({
  default: () => <div>Metas</div>,
}));
vi.mock("@/components/ProfessionalOperationalAlertsPanel", () => ({
  default: () => <div>Alertas</div>,
}));
vi.mock("@/components/ProfessionalReportsWorkspace", () => ({
  default: () => <div>Relatório</div>,
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalAsyncState: ({ title }: { title: string }) => <div>{title}</div>,
  ProfessionalLoadingState: ({ label }: { label: string }) => <div>{label}</div>,
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  ProfessionalPageHeader: ({
    actions,
    title,
  }: {
    actions?: React.ReactNode;
    title: string;
  }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
  ProfessionalPatientHeader: ({ actions }: { actions?: React.ReactNode }) => (
    <section>{actions}</section>
  ),
  ProfessionalSplitLayout: ({
    aside,
    children,
  }: {
    aside?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <div>{children}</div>
      <aside>{aside}</aside>
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      professionalRecord: { get: { invalidate: vi.fn(async () => undefined) } },
      nutrition: {
        professionals: { portfolio: { invalidate: vi.fn(async () => undefined) } },
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

import ProfessionalPatientWorkspace, {
  _forTestOnly_clearProfessionalPatientDraftSnapshots,
} from "./ProfessionalPatientWorkspace";

function recordFixture(overrides: Record<string, unknown> = {}) {
  return {
    patient: {
      trackingStatus: "active",
      authorizationId: "authorization-41",
    },
    latestAssessment: null,
    assessmentHistory: Array.from({ length: 20 }, (_, index) => ({
      id: `assessment-${index + 1}`,
      version: index + 1,
      objective: `Objetivo ${index + 1}`,
      assessedAt: Date.UTC(2026, 6, index + 1, 12),
      authorName: "Nutricionista",
    })),
    notes: [],
    guidances: [],
    timeline: [],
    pagination: {
      totals: { assessments: 41, notes: 21, guidances: 22, timeline: 40 },
      hasMore: true,
    },
    ...overrides,
  };
}

beforeEach(() => {
  location = "/professional/patients/41/assessment";
  selectedPatientId = 41;
  recordData = recordFixture();
  getQuery.mockReset();
  setLocation.mockReset();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "navigation");
  _forTestOnly_clearProfessionalPatientDraftSnapshots();
});

afterEach(() => {
  cleanup();
  _forTestOnly_clearProfessionalPatientDraftSnapshots();
});

describe("professional patient workspace audit corrections", () => {
  it("keeps independent pagination for assessment, notes, guidance and history", async () => {
    const user = userEvent.setup();
    const view = render(<ProfessionalPatientWorkspace />);

    expect(screen.getByRole("navigation", { name: "Paginação de avaliações" })).toBeTruthy();
    expect(screen.getByText("Página 1 de 3")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(getQuery).toHaveBeenLastCalledWith(
        { patientId: 41, page: 2, pageSize: 20 },
        expect.any(Object)
      )
    );

    location = "/professional/patients/41/notes";
    recordData = recordFixture({
      notes: [{ id: "note-1", content: "Nota", createdAt: Date.now() }],
    });
    view.rerender(<ProfessionalPatientWorkspace />);
    expect(screen.getByText("Página 1 de 2")).toBeTruthy();
    expect(getQuery).toHaveBeenLastCalledWith(
      { patientId: 41, page: 1, pageSize: 20 },
      expect.any(Object)
    );

    location = "/professional/patients/41/assessment";
    recordData = recordFixture();
    view.rerender(<ProfessionalPatientWorkspace />);
    expect(screen.getByText("Página 2 de 3")).toBeTruthy();
    expect(getQuery).toHaveBeenLastCalledWith(
      { patientId: 41, page: 2, pageSize: 20 },
      expect.any(Object)
    );
  });

  it("renders canonical labels for goal revisions and tracking transitions", () => {
    location = "/professional/patients/41/history";
    recordData = recordFixture({
      timeline: [
        { id: "goal", eventType: "official_goal_revised", occurredAt: Date.now() },
        { id: "tracking", eventType: "tracking_transitioned", occurredAt: Date.now() },
      ],
      pagination: {
        totals: { assessments: 0, notes: 0, guidances: 0, timeline: 2 },
        hasMore: false,
      },
    });

    render(<ProfessionalPatientWorkspace />);

    expect(screen.getByText("Nova versão da meta oficial ativada")).toBeTruthy();
    expect(screen.getByText("Situação do acompanhamento alterada")).toBeTruthy();
    expect(screen.queryByText("official_goal_revised")).toBeNull();
    expect(screen.queryByText("tracking_transitioned")).toBeNull();
  });

  it("restores a draft after a cancelled popstate fallback remount without leaking it to another patient", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/41/notes";
    recordData = recordFixture({ notes: [] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    const view = render(<ProfessionalPatientWorkspace />);

    const note = screen.getByPlaceholderText(
      "Registre observações internas do acompanhamento."
    ) as HTMLTextAreaElement;
    await user.type(note, "Rascunho preservado");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledWith(
      { professionalDraftGuard: true },
      "",
      "/professional/patients/41/notes"
    );

    view.unmount();
    const samePatient = render(<ProfessionalPatientWorkspace />);
    expect(
      (screen.getByPlaceholderText(
        "Registre observações internas do acompanhamento."
      ) as HTMLTextAreaElement).value
    ).toBe("Rascunho preservado");

    samePatient.unmount();
    selectedPatientId = 42;
    location = "/professional/patients/42/notes";
    render(<ProfessionalPatientWorkspace />);
    expect(
      (screen.getByPlaceholderText(
        "Registre observações internas do acompanhamento."
      ) as HTMLTextAreaElement).value
    ).toBe("");
  });

  it("clears the preserved draft after an explicit discard", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/41/notes";
    recordData = recordFixture({ notes: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = render(<ProfessionalPatientWorkspace />);

    await user.type(
      screen.getByPlaceholderText("Registre observações internas do acompanhamento."),
      "Descartar este texto"
    );
    await user.click(screen.getByRole("button", { name: "Resumo" }));
    expect(setLocation).toHaveBeenCalledWith("/professional/patients/41");

    view.unmount();
    render(<ProfessionalPatientWorkspace />);
    expect(
      (screen.getByPlaceholderText(
        "Registre observações internas do acompanhamento."
      ) as HTMLTextAreaElement).value
    ).toBe("");
  });
});
