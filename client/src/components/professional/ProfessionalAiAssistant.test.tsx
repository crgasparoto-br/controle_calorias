// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let enabledResources: string[] = [];
let saveIsError = false;
const generateMutate = vi.fn();
const saveMutate = vi.fn();
const invalidateMessages = vi.fn(async () => undefined);
const setLocation = vi.fn();
const saveMutationOptions = {
  current: null as null | {
    onSuccess?: (
      result: unknown,
      variables: { patientId: number }
    ) => Promise<void> | void;
  },
};

vi.mock("wouter", () => ({
  useLocation: () => ["/professional/patients/41/reports", setLocation],
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalAsyncState: ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  ),
  ProfessionalLoadingState: ({ label }: { label: string }) => (
    <div>{label}</div>
  ),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      professionalRecord: {
        messages: { list: { invalidate: invalidateMessages } },
      },
    }),
    professionalRecord: {
      settings: {
        entitlements: {
          useQuery: () => ({
            data: { allowed: true, enabledResources },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
      },
      ai: {
        generate: {
          useMutation: () => ({
            mutate: generateMutate,
            isPending: false,
            isError: false,
          }),
        },
      },
      messages: {
        create: {
          useMutation: (options: {
            onSuccess?: (
              result: unknown,
              variables: { patientId: number }
            ) => Promise<void> | void;
          }) => {
            saveMutationOptions.current = options;
            return {
              mutate: saveMutate,
              isPending: false,
              isError: saveIsError,
            };
          },
        },
      },
    },
  },
}));

const patient = { patientId: 41, displayName: "Ana" };
const periodRange = { start: "2026-07-01", end: "2026-07-07" };
const generatedDraft = {
  title: "Resumo assistido",
  summary: "Resumo do período",
  summarySourceKeys: ["current_record_frequency"],
  sourceSignals: [
    {
      key: "current_record_frequency",
      label: "Período atual · Frequência de registros",
      value: "7 de 7 dias",
      period: "current",
    },
  ],
  facts: ["7 de 7 dias com registros."],
  factSourceKeys: [["current_record_frequency"]],
  interpretations: ["Frequência consistente."],
  interpretationSourceKeys: [["current_record_frequency"]],
  missingData: [],
  cautions: [],
  draft: {
    content: "Rascunho sugerido",
    messageType: "guidance" as const,
  },
  educationalNotice:
    "A assistência não substitui diagnóstico, prescrição ou decisão clínica.",
  fallbackUsed: false,
};

beforeEach(() => {
  enabledResources = ["professional_reports"];
  saveIsError = false;
  setLocation.mockClear();
  saveMutate.mockClear();
  invalidateMessages.mockReset();
  invalidateMessages.mockResolvedValue(undefined);
  generateMutate.mockReset();
  saveMutationOptions.current = null;
  generateMutate.mockImplementation(
    (_input: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
      options?.onSuccess?.(generatedDraft);
    }
  );
});

afterEach(cleanup);

describe("ProfessionalAiAssistant", () => {
  it("keeps the report available without exposing unavailable AI actions", async () => {
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    expect(
      screen.getByRole("heading", { name: "Assistência por IA indisponível" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Gerar assistência" })
    ).toBeNull();
    expect(generateMutate).not.toHaveBeenCalled();
  });

  it("generates assistance but does not offer message persistence without messages entitlement", async () => {
    enabledResources = [
      "professional_reports",
      "professional_ai_assistance",
    ];
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar assistência" })
    );

    expect(screen.getByText("Resumo assistido")).toBeTruthy();
    expect(screen.getByDisplayValue("Rascunho sugerido")).toBeTruthy();
    expect(
      screen.getByText(/exige a capacidade de mensagens profissionais/)
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Salvar e abrir conversa" })
    ).toBeNull();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("renders sources, missing data, cautions, educational notice and safe fallback status", async () => {
    enabledResources = [
      "professional_reports",
      "professional_ai_assistance",
    ];
    generateMutate.mockImplementationOnce(
      (_input: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
        options?.onSuccess?.({
          ...generatedDraft,
          fallbackUsed: true,
          missingData: ["Não há pesagens no período anterior."],
          cautions: ["Confirme os registros antes de orientar o paciente."],
        });
      }
    );
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar assistência" })
    );

    expect(
      screen.getAllByText(/Fontes: Período atual · Frequência de registros/)
    ).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Fontes conferíveis" })).toBeTruthy();
    expect(screen.getByText("7 de 7 dias")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dados ausentes" })).toBeTruthy();
    expect(screen.getByText("Não há pesagens no período anterior.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pontos para revisar" })).toBeTruthy();
    expect(
      screen.getByText("Confirme os registros antes de orientar o paciente.")
    ).toBeTruthy();
    expect(screen.getByText(/Modo seguro determinístico usado/)).toBeTruthy();
    expect(
      screen.getByText(/não substitui diagnóstico, prescrição ou decisão clínica/)
    ).toBeTruthy();
  });

  it("keeps the editable draft visible and explains a save failure in product language", async () => {
    enabledResources = [
      "professional_reports",
      "professional_ai_assistance",
      "professional_messages",
    ];
    saveIsError = true;
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar assistência" })
    );

    expect(screen.getByDisplayValue("Rascunho sugerido")).toBeTruthy();
    expect(
      screen.getByRole("alert").textContent
    ).toContain("O texto continua disponível para revisão");
  });

  it("offers message persistence only when messages are also enabled", async () => {
    enabledResources = [
      "professional_reports",
      "professional_ai_assistance",
      "professional_messages",
    ];
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar assistência" })
    );

    expect(
      screen.getByRole("button", { name: "Salvar e abrir conversa" })
    ).toBeTruthy();
  });

  it("opens the conversation for the patient persisted by the completed mutation", async () => {
    enabledResources = [
      "professional_reports",
      "professional_ai_assistance",
      "professional_messages",
    ];
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    const view = render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar assistência" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar e abrir conversa" })
    );

    const savedVariables = saveMutate.mock.calls[0]?.[0] as {
      patientId: number;
    };
    expect(savedVariables.patientId).toBe(41);

    view.rerender(
      <ProfessionalAiAssistant
        patient={{ patientId: 42, displayName: "Bia" }}
        periodRange={periodRange}
      />
    );
    await act(async () => {
      await saveMutationOptions.current?.onSuccess?.({}, savedVariables);
    });

    expect(setLocation).toHaveBeenLastCalledWith(
      "/professional/patients/41/messages"
    );
  });

  it("opens the persisted patient conversation even when cache invalidation fails", async () => {
    enabledResources = [
      "professional_reports",
      "professional_ai_assistance",
      "professional_messages",
    ];
    invalidateMessages.mockRejectedValueOnce(new Error("cache unavailable"));
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar assistência" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar e abrir conversa" })
    );
    const savedVariables = saveMutate.mock.calls[0]?.[0] as {
      patientId: number;
    };

    await act(async () => {
      await saveMutationOptions.current?.onSuccess?.({}, savedVariables);
    });

    expect(setLocation).toHaveBeenLastCalledWith(
      "/professional/patients/41/messages"
    );
  });

  it("discards a late response after the patient period changes", async () => {
    enabledResources = [
      "professional_reports",
      "professional_ai_assistance",
    ];
    let resolveRequest: ((data: unknown) => void) | undefined;
    generateMutate.mockImplementationOnce(
      (_input: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
        resolveRequest = options?.onSuccess;
      }
    );
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    const view = render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar assistência" })
    );
    view.rerender(
      <ProfessionalAiAssistant
        patient={patient}
        periodRange={{ start: "2026-07-08", end: "2026-07-14" }}
      />
    );
    act(() => resolveRequest?.({ ...generatedDraft, title: "Resposta antiga" }));

    expect(screen.queryByText("Resposta antiga")).toBeNull();
  });

  it("invalidates the visible result immediately when the mode changes", async () => {
    enabledResources = [
      "professional_reports",
      "professional_ai_assistance",
    ];
    const { default: ProfessionalAiAssistant } = await import(
      "./ProfessionalAiAssistant"
    );
    render(
      <ProfessionalAiAssistant patient={patient} periodRange={periodRange} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar assistência" })
    );
    expect(screen.getByText("Resumo assistido")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Tipo de assistência"), {
      target: { value: "comparison" },
    });

    expect(screen.queryByText("Resumo assistido")).toBeNull();
  });
});
