// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let location = "/professional/patients/41/assessment";
let selectedPatientId = 41;
let selectedAuthorizationId = "authorization-41";
let selectedNextReviewAt: number | null = null;
let routeAccessStatus: "ready" | "validating" | "error" = "ready";
let recordData: any;
const setLocation = vi.fn();
const getQuery = vi.fn();
const contextInvalidate = vi.fn(async () => undefined);
const retryRouteAccess = vi.fn();

const mutation = vi.hoisted(() => () => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
}));

vi.mock("wouter", () => ({
  useLocation: () => [location, setLocation],
}));

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({
    selectedPatient: {
      patientId: selectedPatientId,
      authorizationId: selectedAuthorizationId,
      displayName: `Paciente ${selectedPatientId}`,
      authorizationStatus: "approved",
      lastActivityAt: null,
      nextReviewAt: selectedNextReviewAt,
      trackingStatus: "active",
    },
    routeAccessStatus,
    retryRouteAccess,
  }),
}));

vi.mock("@/components/ProfessionalMessagesPanel", () => ({
  default: () => <div>Mensagens</div>,
}));
vi.mock("@/components/ProfessionalOfficialGoalCard", () => {
  const createEmptyProfessionalOfficialGoalDraft = () => ({
    target: {
      calories: "",
      proteinGrams: "",
      carbsGrams: "",
      fatGrams: "",
    },
    effectiveFrom: "2026-07-27",
    justification: "",
    includeExerciseCalories: true,
    exceptions: [],
    sourceGoalId: null,
    touched: false,
  });
  return {
    createEmptyProfessionalOfficialGoalDraft,
    default: ({ draft, onDraftChange }: any) => (
      <div>
        <label>
          Justificativa da meta
          <textarea
            aria-label="Justificativa da meta"
            value={draft.justification}
            onChange={event =>
              onDraftChange((current: any) => ({
                ...current,
                justification: event.target.value,
                touched: true,
              }))
            }
          />
        </label>
        <button
          type="button"
          onClick={() =>
            onDraftChange((current: any) => ({
              ...current,
              exceptions: [
                ...current.exceptions,
                {
                  weekday: 0,
                  durationType: "always",
                  calories: "2000",
                  proteinGrams: "120",
                  carbsGrams: "250",
                  fatGrams: "70",
                },
              ],
              touched: true,
            }))
          }
        >
          Adicionar exceção da meta
        </button>
        <span data-testid="goal-exception-count">
          {draft.exceptions.length}
        </span>
      </div>
    ),
  };
});
vi.mock("@/components/ProfessionalOperationalAlertsPanel", () => ({
  default: () => <div>Alertas</div>,
}));
vi.mock("@/components/ProfessionalReportsWorkspace", () => ({
  default: () => <div>Relatório</div>,
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalAsyncState: ({
    onRetry,
    title,
  }: {
    onRetry?: () => void;
    title: string;
  }) => (
    <div>
      {title}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Tentar novamente
        </button>
      ) : null}
    </div>
  ),
  ProfessionalLoadingState: ({ label }: { label: string }) => (
    <div>{label}</div>
  ),
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
      professionalRecord: {
        context: { invalidate: contextInvalidate },
        get: { invalidate: vi.fn(async () => undefined) },
      },
      nutrition: {
        professionals: {
          portfolio: { invalidate: vi.fn(async () => undefined) },
        },
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
      transitionTracking: {
        useMutation: (options: {
          onSuccess?: (
            data: unknown,
            variables: { status: "active" | "paused" | "ended" }
          ) => void | Promise<void>;
        }) => ({
          ...mutation(),
          mutate: (input: { status: "active" | "paused" | "ended" }) => {
            void options.onSuccess?.({}, input);
          },
        }),
      },
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
  selectedAuthorizationId = "authorization-41";
  selectedNextReviewAt = null;
  routeAccessStatus = "ready";
  recordData = recordFixture();
  contextInvalidate.mockClear();
  retryRouteAccess.mockClear();
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
  it("keeps the header mounted, blocks the new section until its entitlement is ready and restores the goal draft", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/41/goals";
    const view = render(<ProfessionalPatientWorkspace />);

    await user.type(
      screen.getByLabelText("Justificativa da meta"),
      "Ajuste para novo ciclo"
    );
    await user.click(
      screen.getByRole("button", { name: "Adicionar exceção da meta" })
    );
    expect(screen.getByTestId("goal-exception-count").textContent).toBe("1");

    location = "/professional/patients/41/reports";
    routeAccessStatus = "validating";
    view.rerender(<ProfessionalPatientWorkspace />);

    expect(screen.getByRole("heading", { name: "Paciente 41" })).toBeTruthy();
    expect(
      screen.getByText(
        "Validando o acesso a esta área sem fechar o workspace..."
      )
    ).toBeTruthy();
    expect(screen.queryByText("Relatório")).toBeNull();

    routeAccessStatus = "error";
    view.rerender(<ProfessionalPatientWorkspace />);
    expect(screen.getByRole("heading", { name: "Paciente 41" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(retryRouteAccess).toHaveBeenCalledTimes(1);

    routeAccessStatus = "ready";
    view.rerender(<ProfessionalPatientWorkspace />);
    expect(screen.getByText("Relatório")).toBeTruthy();

    location = "/professional/patients/41/goals";
    view.rerender(<ProfessionalPatientWorkspace />);

    expect(
      (screen.getByLabelText("Justificativa da meta") as HTMLTextAreaElement)
        .value
    ).toBe("Ajuste para novo ciclo");
    expect(screen.getByTestId("goal-exception-count").textContent).toBe("1");
  });

  it("keeps independent pagination for assessment, notes, guidance and history", async () => {
    const user = userEvent.setup();
    const view = render(<ProfessionalPatientWorkspace />);

    expect(
      screen.getByRole("navigation", { name: "Paginação de avaliações" })
    ).toBeTruthy();
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

  it("renders every audited canonical event with its server-sanitized label", () => {
    location = "/professional/patients/41/history";
    recordData = recordFixture({
      timeline: [
        {
          id: "goal",
          eventType: "official_goal_revised",
          label: "Nova versão da meta oficial ativada",
          occurredAt: Date.now(),
        },
        {
          id: "tracking",
          eventType: "tracking_transitioned",
          label: "Situação do acompanhamento alterada",
          occurredAt: Date.now(),
        },
        {
          id: "goal-review",
          eventType: "official_goal_review_requested",
          label: "Revisão da meta oficial solicitada",
          occurredAt: Date.now(),
        },
        {
          id: "message-draft",
          eventType: "professional_message_drafted",
          label: "Rascunho de mensagem registrado",
          occurredAt: Date.now(),
        },
        {
          id: "message-response",
          eventType: "professional_message_response_received",
          label: "Resposta do paciente recebida",
          occurredAt: Date.now(),
        },
      ],
      pagination: {
        totals: { assessments: 0, notes: 0, guidances: 0, timeline: 5 },
        hasMore: false,
      },
    });

    render(<ProfessionalPatientWorkspace />);

    for (const label of [
      "Nova versão da meta oficial ativada",
      "Situação do acompanhamento alterada",
      "Revisão da meta oficial solicitada",
      "Rascunho de mensagem registrado",
      "Resposta do paciente recebida",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(
      screen.getByRole("navigation", { name: "Paginação de histórico" })
    ).toBeTruthy();
    expect(screen.getByText("Página 1 de 1")).toBeTruthy();
    for (const eventType of [
      "official_goal_revised",
      "tracking_transitioned",
      "official_goal_review_requested",
      "professional_message_drafted",
      "professional_message_response_received",
    ]) {
      expect(screen.queryByText(eventType)).toBeNull();
    }
  });

  it("uses the canonical tracking review date in the workspace summary", () => {
    location = "/professional/patients/41";
    selectedNextReviewAt = Date.UTC(2026, 8, 15, 12);
    recordData = recordFixture({
      latestAssessment: {
        id: "assessment-latest",
        version: 4,
        objective: "Reduzir gordura corporal",
        assessedAt: Date.UTC(2026, 6, 20, 12),
        nextReviewAt: Date.UTC(2026, 7, 1, 12),
        authorName: "Nutricionista",
      },
    });

    render(<ProfessionalPatientWorkspace />);

    expect(screen.getByText(/15\/09\/2026/)).toBeTruthy();
    expect(screen.queryByText(/01\/08\/2026/)).toBeNull();
  });

  it("restores a draft after a cancelled popstate fallback remount without leaking it to another patient", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/41/notes";
    recordData = recordFixture({ notes: [] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const pushState = vi
      .spyOn(window.history, "pushState")
      .mockImplementation(() => undefined);
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
      (
        screen.getByPlaceholderText(
          "Registre observações internas do acompanhamento."
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Rascunho preservado");

    samePatient.unmount();
    selectedPatientId = 42;
    location = "/professional/patients/42/notes";
    render(<ProfessionalPatientWorkspace />);
    expect(
      (
        screen.getByPlaceholderText(
          "Registre observações internas do acompanhamento."
        ) as HTMLTextAreaElement
      ).value
    ).toBe("");
  });

  it("does not restore a draft when the same patient receives a new authorization", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/41/notes";
    recordData = recordFixture({ notes: [] });
    const view = render(<ProfessionalPatientWorkspace />);

    await user.type(
      screen.getByPlaceholderText(
        "Registre observações internas do acompanhamento."
      ),
      "Rascunho da autorização anterior"
    );
    view.unmount();

    selectedAuthorizationId = "authorization-41-renewed";
    render(<ProfessionalPatientWorkspace />);
    expect(
      (
        screen.getByPlaceholderText(
          "Registre observações internas do acompanhamento."
        ) as HTMLTextAreaElement
      ).value
    ).toBe("");
  });

  it("does not restore an official goal draft in a new authorization cycle", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/41/goals";
    const view = render(<ProfessionalPatientWorkspace />);

    await user.type(
      screen.getByLabelText("Justificativa da meta"),
      "Rascunho da autorização anterior"
    );
    await user.click(
      screen.getByRole("button", { name: "Adicionar exceção da meta" })
    );
    view.unmount();

    selectedAuthorizationId = "authorization-41-renewed";
    render(<ProfessionalPatientWorkspace />);
    expect(
      (screen.getByLabelText("Justificativa da meta") as HTMLTextAreaElement)
        .value
    ).toBe("");
    expect(screen.getByTestId("goal-exception-count").textContent).toBe("0");
  });

  it("explains pause and end consequences on the follow-up cycle controls", () => {
    location = "/professional/patients/41";
    recordData = recordFixture();
    render(<ProfessionalPatientWorkspace />);

    expect(
      screen.getByRole("button", { name: "Pausar" }).getAttribute("title")
    ).toBe(
      "Suspende temporariamente o acompanhamento. O histórico continua disponível, mas novas intervenções ficam bloqueadas até a retomada."
    );
    expect(
      screen.getByRole("button", { name: "Encerrar" }).getAttribute("title")
    ).toBe(
      "Finaliza o acompanhamento. Após o encerramento, somente as mensagens anteriores e o histórico permanecem disponíveis para consulta."
    );
  });

  it("redirects immediately to history and refreshes canonical context when tracking ends", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/41";
    recordData = recordFixture();
    render(<ProfessionalPatientWorkspace />);

    await user.click(screen.getByRole("button", { name: "Encerrar" }));

    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients/41/history"
      )
    );
    expect(contextInvalidate).toHaveBeenCalledWith({
      patientId: 41,
      resource: "professional_record",
    });
  });

  it("exposes persistent accessible labels for guidance and private notes", () => {
    location = "/professional/patients/41/guidance";
    recordData = recordFixture({ guidances: [] });
    const view = render(<ProfessionalPatientWorkspace />);

    expect(
      screen.getByRole("textbox", { name: "Título da orientação" })
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", {
        name: "Conteúdo da orientação ao paciente",
      })
    ).toBeTruthy();

    location = "/professional/patients/41/notes";
    recordData = recordFixture({ notes: [] });
    view.rerender(<ProfessionalPatientWorkspace />);
    expect(
      screen.getByRole("textbox", { name: "Conteúdo da anotação privada" })
    ).toBeTruthy();
  });

  it("clears the preserved draft after an explicit discard", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/41/notes";
    recordData = recordFixture({ notes: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = render(<ProfessionalPatientWorkspace />);

    await user.type(
      screen.getByPlaceholderText(
        "Registre observações internas do acompanhamento."
      ),
      "Descartar este texto"
    );
    await user.click(screen.getByRole("button", { name: "Resumo" }));
    expect(setLocation).toHaveBeenCalledWith("/professional/patients/41");

    view.unmount();
    render(<ProfessionalPatientWorkspace />);
    expect(
      (
        screen.getByPlaceholderText(
          "Registre observações internas do acompanhamento."
        ) as HTMLTextAreaElement
      ).value
    ).toBe("");
  });
});
