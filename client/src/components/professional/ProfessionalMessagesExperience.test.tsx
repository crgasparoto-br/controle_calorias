// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMutate = vi.fn();
const retryMutate = vi.fn();
const invalidateMessages = vi.fn().mockResolvedValue(undefined);
let messages: any[] = [];
let trackingStatus: "active" | "paused" | "ended" = "active";

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({
    selectedPatient: {
      patientId: 41,
      displayName: "Ana",
      trackingStatus,
    },
    clearPatient: vi.fn(),
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/professional/patients/41/messages", vi.fn()],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      professionalRecord: {
        messages: { list: { invalidate: invalidateMessages } },
      },
    }),
    professionalRecord: {
      messages: {
        templates: {
          useQuery: () => ({ data: [], isError: false }),
        },
        recipients: {
          useQuery: () => ({ data: [], isError: false }),
        },
        list: {
          useQuery: () => ({
            data: { items: messages, nextCursor: null },
            isLoading: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
          }),
        },
        create: {
          useMutation: (options: { onSuccess?: () => Promise<void> }) => ({
            mutate: createMutate,
            isPending: false,
            isError: false,
            error: null,
            options,
          }),
        },
        retry: {
          useMutation: () => ({
            mutate: retryMutate,
            isPending: false,
          }),
        },
      },
    },
  },
}));

afterEach(cleanup);

beforeEach(() => {
  createMutate.mockReset();
  retryMutate.mockReset();
  invalidateMessages.mockClear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  messages = [];
  trackingStatus = "active";
});

describe("ProfessionalMessagesExperience", () => {
  it("continues an AI draft as a new explicit version", async () => {
    messages = [
      {
        id: "draft-ai-1",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "ai_suggested",
        messageType: "follow_up_summary",
        content: "Resumo preparado pela IA",
        state: "draft",
        createdAt: Date.now(),
      },
    ];
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    await userEvent.click(
      screen.getByRole("button", { name: "Continuar edição" })
    );
    const editor = screen.getByLabelText("Conteúdo da mensagem");
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Resumo preparado pela IA"
    );
    expect(
      (screen.getByLabelText("Origem da mensagem") as HTMLSelectElement).value
    ).toBe("ai_suggested");

    fireEvent.change(editor, {
      target: { value: "Resumo revisado pelo nutricionista" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Salvar rascunho" })
    );

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 41,
        content: "Resumo revisado pelo nutricionista",
        origin: "ai_suggested",
        action: "save_draft",
        supersedesMessageId: "draft-ai-1",
      })
    );
  });

  it("requires review of automatic drafts before delivery", async () => {
    messages = [
      {
        id: "draft-auto-1",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "automatic",
        messageType: "reminder",
        content: "Lembrete automático",
        state: "draft",
        createdAt: Date.now(),
      },
    ];
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    await userEvent.click(
      screen.getByRole("button", { name: "Continuar edição" })
    );
    expect(
      screen
        .getByRole("button", { name: "Enviar por WhatsApp" })
        .hasAttribute("disabled")
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Origem da mensagem"), {
      target: { value: "professional" },
    });
    expect(
      screen
        .getByRole("button", { name: "Enviar por WhatsApp" })
        .hasAttribute("disabled")
    ).toBe(false);
  });

  it("blocks delivery while the tracking is ended without loading the record resource", async () => {
    trackingStatus = "ended";
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Mensagem após encerramento" },
    });

    expect(
      screen
        .getByRole("button", { name: "Enviar por WhatsApp" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.getByText(
        "O acompanhamento foi encerrado e não aceita novas mensagens."
      )
    ).toBeTruthy();
  });
});
