// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfessionalAiWorkspace from "./ProfessionalAiWorkspace";

const createMessage = vi.fn();
const invalidate = vi.fn().mockResolvedValue(undefined);
const setLocation = vi.fn();
const generateRequests: Array<{
  input: unknown;
  onSuccess: (data: any) => void;
}> = [];

function result(overrides: Record<string, unknown> = {}) {
  return {
    title: "Resumo do período",
    summary: "Resumo objetivo.",
    summarySourceKeys: ["current_record_frequency"],
    facts: ["7 de 7 dias com registros."],
    factSourceKeys: [["current_record_frequency"]],
    interpretations: ["Frequência consistente."],
    interpretationSourceKeys: [["current_record_frequency"]],
    missingData: [],
    cautions: [],
    draft: null,
    educationalNotice: "Aviso educativo.",
    fallbackUsed: false,
    sourceSignals: [
      {
        key: "current_record_frequency",
        label: "Período atual · Frequência de registros",
        value: "7 de 7",
        period: "current",
      },
    ],
    ...overrides,
  };
}

vi.mock("wouter", () => ({
  useLocation: () => ["/professional/reports", setLocation],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      professionalRecord: { messages: { list: { invalidate } } },
    }),
    professionalRecord: {
      ai: {
        priorities: {
          useQuery: () => ({
            data: [],
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
        generate: {
          useMutation: () => ({
            isPending: false,
            isError: false,
            mutate: (
              input: unknown,
              options: { onSuccess: (data: unknown) => void }
            ) => generateRequests.push({ input, onSuccess: options.onSuccess }),
          }),
        },
      },
      messages: {
        create: {
          useMutation: (options: { onSuccess: () => void }) => ({
            isPending: false,
            isError: false,
            mutate: (input: unknown) => {
              createMessage(input);
              void options.onSuccess();
            },
          }),
        },
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  createMessage.mockClear();
  invalidate.mockClear();
  setLocation.mockClear();
  generateRequests.length = 0;
});

describe("ProfessionalAiWorkspace", () => {
  it("keeps an AI draft local until the professional explicitly saves it", async () => {
    render(
      <ProfessionalAiWorkspace
        selectedPatient={{ patientId: 41, displayName: "Ana" }}
        periodRange={{ start: "2026-07-01", end: "2026-07-07" }}
        onOpenPatient={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Tipo de assistência"), {
      target: { value: "draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gerar assistência" }));
    act(() =>
      generateRequests[0].onSuccess(
        result({
          title: "Rascunho de acompanhamento",
          draft: {
            messageType: "follow_up_summary",
            content: "Texto sugerido para revisão.",
          },
        })
      )
    );

    expect(await screen.findByDisplayValue("Texto sugerido para revisão.")).toBeTruthy();
    expect(createMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Salvar em Mensagens" }));

    await waitFor(() =>
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 41,
          action: "save_draft",
          origin: "ai_suggested",
          messageType: "follow_up_summary",
        })
      )
    );
    expect(setLocation).toHaveBeenCalledWith("/professional/messages");
  });

  it("shows the exact source used by each summary, fact and interpretation", () => {
    render(
      <ProfessionalAiWorkspace
        selectedPatient={{ patientId: 41, displayName: "Ana" }}
        periodRange={{ start: "2026-07-01", end: "2026-07-07" }}
        onOpenPatient={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Gerar assistência" }));
    act(() => generateRequests[0].onSuccess(result()));

    expect(
      screen.getAllByText(/Fontes: Período atual · Frequência de registros/)
    ).toHaveLength(3);
    expect(
      screen.getByText(/O catálogo abaixo contém todos os sinais enviados/)
    ).toBeTruthy();
  });

  it("discards a late response after the selected patient changes", () => {
    const view = render(
      <ProfessionalAiWorkspace
        selectedPatient={{ patientId: 41, displayName: "Ana" }}
        periodRange={{ start: "2026-07-01", end: "2026-07-07" }}
        onOpenPatient={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Gerar assistência" }));
    const delayed = generateRequests[0];

    view.rerender(
      <ProfessionalAiWorkspace
        selectedPatient={{ patientId: 42, displayName: "Bia" }}
        periodRange={{ start: "2026-07-01", end: "2026-07-07" }}
        onOpenPatient={vi.fn()}
      />
    );
    act(() => delayed.onSuccess(result({ title: "Resposta antiga" })));

    expect(screen.queryByText("Resposta antiga")).toBeNull();
  });

  it("discards a late response after the period or mode changes", () => {
    const view = render(
      <ProfessionalAiWorkspace
        selectedPatient={{ patientId: 41, displayName: "Ana" }}
        periodRange={{ start: "2026-07-01", end: "2026-07-07" }}
        onOpenPatient={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Gerar assistência" }));
    const delayedByPeriod = generateRequests[0];
    view.rerender(
      <ProfessionalAiWorkspace
        selectedPatient={{ patientId: 41, displayName: "Ana" }}
        periodRange={{ start: "2026-07-08", end: "2026-07-14" }}
        onOpenPatient={vi.fn()}
      />
    );
    act(() => delayedByPeriod.onSuccess(result({ title: "Período antigo" })));
    expect(screen.queryByText("Período antigo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Gerar assistência" }));
    const delayedByMode = generateRequests[1];
    fireEvent.change(screen.getByLabelText("Tipo de assistência"), {
      target: { value: "comparison" },
    });
    act(() => delayedByMode.onSuccess(result({ title: "Modo antigo" })));
    expect(screen.queryByText("Modo antigo")).toBeNull();
  });
});
