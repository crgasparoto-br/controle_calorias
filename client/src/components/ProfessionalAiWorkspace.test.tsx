// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfessionalAiWorkspace from "./ProfessionalAiWorkspace";

const createMessage = vi.fn();
const invalidate = vi.fn().mockResolvedValue(undefined);
const setLocation = vi.fn();

vi.mock("wouter", () => ({ useLocation: () => ["/professional/reports", setLocation] }));
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
            mutate: (_input: unknown, options: { onSuccess: (data: unknown) => void }) =>
              options.onSuccess({
                title: "Rascunho de acompanhamento",
                summary: "Resumo objetivo.",
                facts: ["7 de 7 dias com registros."],
                interpretations: ["Frequência consistente."],
                missingData: [],
                cautions: [],
                draft: {
                  messageType: "follow_up_summary",
                  content: "Texto sugerido para revisão.",
                },
                educationalNotice: "Aviso educativo.",
                fallbackUsed: false,
                sourceSignals: [
                  { key: "frequency", label: "Frequência", value: "7 de 7" },
                ],
              }),
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
});
