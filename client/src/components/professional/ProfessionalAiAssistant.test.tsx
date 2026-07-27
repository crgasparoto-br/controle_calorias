// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let enabledResources: string[] = [];
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
  sourceSignals: [],
  facts: [],
  interpretations: [],
  draft: { content: "Rascunho sugerido", messageType: "guidance" },
};

beforeEach(() => {
  enabledResources = ["professional_reports"];
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

describe("ProfessionalAiAssistant entitlement", () => {
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
    expect(screen.queryByRole("button", { name: "Gerar assistência" })).toBeNull();
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
});
