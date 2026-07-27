// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let enabledResources: string[] = [];
const generateMutate = vi.fn();
const saveMutate = vi.fn();
const setLocation = vi.fn();

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
        messages: { list: { invalidate: vi.fn(async () => undefined) } },
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
          useMutation: () => ({
            mutate: saveMutate,
            isPending: false,
          }),
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
  generateMutate.mockReset();
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
});
