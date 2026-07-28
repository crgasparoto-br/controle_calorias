// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMutate = vi.fn();
const retryMutate = vi.fn();
const invalidateMessages = vi.fn().mockResolvedValue(undefined);
const refetchMessages = vi.fn();
const setLocation = vi.fn();
const emptyTemplates: never[] = [];
let messageResult: {
  items: any[];
  nextCursor: { createdAt: number; id: string } | null;
} = {
  items: [],
  nextCursor: null,
};
const listUseQuery = vi.fn(
  (_input?: unknown, _options?: unknown) => ({
    data: messageResult,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: refetchMessages,
  })
);
let trackingStatus: "not_started" | "active" | "paused" | "ended" =
  "active";
let patientSelected = true;
let currentLocation = "/professional/patients/41/messages";
let retryError = false;
let retryVariables: { messageId: string } | undefined;

function setMessages(
  items: any[],
  nextCursor: { createdAt: number; id: string } | null = null
) {
  messageResult = { items, nextCursor };
}

function traversalEvent() {
  const event = new Event("navigate", { cancelable: true });
  Object.defineProperty(event, "navigationType", {
    configurable: true,
    value: "traverse",
  });
  return event;
}

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({
    selectedPatient: patientSelected
      ? {
          patientId: 41,
          displayName: "Ana",
          trackingStatus,
        }
      : null,
    clearPatient: vi.fn(),
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, setLocation],
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
          useQuery: () => ({ data: emptyTemplates, isError: false }),
        },
        list: {
          useQuery: listUseQuery,
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
            isError: retryError,
            error: null,
            variables: retryVariables,
          }),
        },
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "navigation");
  vi.restoreAllMocks();
});

beforeEach(() => {
  createMutate.mockReset();
  retryMutate.mockReset();
  invalidateMessages.mockClear();
  refetchMessages.mockReset();
  listUseQuery.mockClear();
  setLocation.mockReset();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  setMessages([]);
  trackingStatus = "active";
  patientSelected = true;
  currentLocation = "/professional/patients/41/messages";
  retryError = false;
  retryVariables = undefined;
});

describe("ProfessionalMessagesExperience", () => {
  it("continues an AI draft as a new explicit version", async () => {
    setMessages([
      {
        id: "draft-ai-1",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "ai_suggested",
        messageType: "follow_up_summary",
        content: "Resumo preparado pela IA",
        state: "draft",
        createdAt: Date.now(),
        authorName: "Nutricionista",
        patientName: "Ana",
      },
    ]);
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
    expect(
      screen.getByLabelText("Origem da mensagem").hasAttribute("disabled")
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Origem da mensagem"), {
      target: { value: "professional" },
    });

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
    setMessages([
      {
        id: "draft-auto-1",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "automatic",
        messageType: "reminder",
        content: "Lembrete automático",
        state: "draft",
        createdAt: Date.now(),
        authorName: "Nutricionista",
        patientName: "Ana",
      },
    ]);
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

  it("keeps an ended conversation readable while blocking every new action", async () => {
    trackingStatus = "ended";
    setMessages([
      {
        id: "failed-before-end",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "professional",
        messageType: "administrative",
        content: "Mensagem registrada antes do encerramento",
        state: "failed",
        createdAt: Date.now(),
        authorName: "Claudinei",
        patientName: "Ana",
      },
    ]);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    expect(
      screen.getByText("Mensagem registrada antes do encerramento")
    ).toBeTruthy();
    expect(screen.getByText(/Por Claudinei/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Salvar rascunho" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Enviar por WhatsApp" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Tentar novamente" })
    ).toBeNull();
    expect(
      screen.getByText(
        "O acompanhamento foi encerrado. As mensagens anteriores permanecem disponíveis somente para consulta."
      )
    ).toBeTruthy();
  });

  it("allows only administrative drafts while tracking is paused", async () => {
    trackingStatus = "paused";
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Contato durante a pausa" },
    });
    expect(
      screen
        .getByRole("button", { name: "Salvar rascunho" })
        .hasAttribute("disabled")
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Tipo da mensagem"), {
      target: { value: "administrative" },
    });
    expect(
      screen
        .getByRole("button", { name: "Salvar rascunho" })
        .hasAttribute("disabled")
    ).toBe(false);
  });

  it("renders the individual conversation in chronological order with authorship", async () => {
    setMessages([
      {
        id: "newer",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "professional",
        messageType: "guidance",
        content: "Mensagem mais nova",
        state: "sent",
        createdAt: Date.parse("2026-07-22T12:00:00.000Z"),
        authorName: "Dra. Beatriz",
        patientName: "Ana",
      },
      {
        id: "older",
        patientUserId: 41,
        direction: "patient_to_professional",
        origin: "patient",
        messageType: "response",
        content: "Mensagem mais antiga",
        state: "received",
        createdAt: Date.parse("2026-07-21T12:00:00.000Z"),
        authorName: "Ana",
        patientName: "Ana",
      },
    ]);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    const articles = screen.getAllByRole("article");
    expect(articles[0]?.textContent).toContain("Mensagem mais antiga");
    expect(articles[0]?.textContent).toContain("Por Ana");
    expect(articles[1]?.textContent).toContain("Mensagem mais nova");
    expect(articles[1]?.textContent).toContain("Por Dra. Beatriz");
  });

  it("protects the direct personal-area exit while a message draft is unsaved", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(
      <>
        <Experience />
        <div data-sidebar="footer">
          <button type="button" onClick={() => setLocation("/today")}>
            Minha alimentação
          </button>
        </div>
      </>
    );

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Rascunho que não pode ser descartado silenciosamente" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Minha alimentação" })
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(setLocation).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(
      screen.getByRole("button", { name: "Minha alimentação" })
    );
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(setLocation).toHaveBeenCalledWith("/today");
  });

  it("blocks navigation to a different patient until the unsaved draft is explicitly discarded", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(
      <>
        <Experience />
        <button
          type="button"
          data-professional-navigation
          onClick={() => setLocation("/professional/patients/42/messages")}
        >
          Abrir mensagens de Bruno
        </button>
      </>
    );

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Rascunho exclusivo da paciente Ana" },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Abrir mensagens de Bruno" })
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(setLocation).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Conteúdo da mensagem") as HTMLTextAreaElement)
        .value
    ).toBe("Rascunho exclusivo da paciente Ana");

    await userEvent.click(
      screen.getByRole("button", { name: "Abrir mensagens de Bruno" })
    );
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(setLocation).toHaveBeenCalledWith(
      "/professional/patients/42/messages"
    );
    expect(
      (screen.getByLabelText("Conteúdo da mensagem") as HTMLTextAreaElement)
        .value
    ).toBe("");
  });

  it("prevents browser back or forward when the unsaved message draft is kept", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: navigation,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Rascunho protegido no histórico" },
    });
    const event = traversalEvent();
    const notCancelled = navigation.dispatchEvent(event);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(
      (screen.getByLabelText("Conteúdo da mensagem") as HTMLTextAreaElement)
        .value
    ).toBe("Rascunho protegido no histórico");
  });

  it("allows browser back or forward only after discarding the unsaved message draft", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: navigation,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Rascunho a descartar antes de voltar" },
    });
    const event = traversalEvent();
    const notCancelled = navigation.dispatchEvent(event);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Conteúdo da mensagem") as HTMLTextAreaElement)
          .value
      ).toBe("");
    });
  });

  it("registers the browser-exit guard while the message draft is unsaved", async () => {
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Rascunho protegido no fechamento" },
    });
    const event = new Event("beforeunload", {
      bubbles: false,
      cancelable: true,
    });
    const notCancelled = window.dispatchEvent(event);

    expect(notCancelled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("rearms the unsaved draft guard when a confirmed click stays on the same route", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(
      <>
        <Experience />
        <button
          type="button"
          data-professional-navigation
          onClick={() => setLocation(currentLocation)}
        >
          Mensagens atuais
        </button>
        <button
          type="button"
          data-professional-navigation
          onClick={() => setLocation("/professional/patients/41/reports")}
        >
          Relatórios
        </button>
      </>
    );

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Rascunho ainda não salvo" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Mensagens atuais" })
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(setLocation).toHaveBeenCalledWith(currentLocation);
    expect(
      (screen.getByLabelText("Conteúdo da mensagem") as HTMLTextAreaElement)
        .value
    ).toBe("");

    fireEvent.change(screen.getByLabelText("Conteúdo da mensagem"), {
      target: { value: "Novo rascunho na mesma rota" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Relatórios" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(setLocation).not.toHaveBeenCalledWith(
      "/professional/patients/41/reports"
    );
  });

  it("keeps a latest-page polling query active after loading older messages", async () => {
    setMessages(
      [
        {
          id: "latest-message",
          patientUserId: 41,
          direction: "professional_to_patient",
          origin: "professional",
          messageType: "guidance",
          content: "Mensagem recente",
          state: "sent",
          createdAt: Date.now(),
          authorName: "Nutricionista",
          patientName: "Ana",
        },
      ],
      { createdAt: Date.now() - 60_000, id: "older-cursor" }
    );
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    await userEvent.click(
      screen.getByRole("button", { name: "Carregar mensagens anteriores" })
    );

    expect(listUseQuery.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({ patientId: 41, pageSize: 20 }),
          expect.objectContaining({
            enabled: true,
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
          }),
        ],
      ])
    );
  });

  it("sends inbox search and state filters to the paginated backend query", async () => {
    patientSelected = false;
    currentLocation = "/professional/messages";
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    await userEvent.type(
      screen.getByPlaceholderText("Buscar paciente ou conteúdo"),
      "Ana"
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Filtrar estado da mensagem"),
      "failed"
    );

    expect(listUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patientId: undefined,
        pageSize: 20,
        search: "Ana",
        state: "failed",
      }),
      expect.any(Object)
    );
  });

  it("shows retry only when the backend marks the logical message as retryable", async () => {
    setMessages([
      {
        id: "failed-without-attempt",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "professional",
        messageType: "guidance",
        content: "Falha sem tentativa física",
        state: "failed",
        retryable: false,
        createdAt: Date.now(),
      },
      {
        id: "failed-with-attempt",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "professional",
        messageType: "guidance",
        content: "Falha elegível",
        state: "failed",
        retryable: true,
        createdAt: Date.now() + 1,
      },
    ]);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    expect(
      screen.getAllByRole("button", { name: "Tentar novamente" })
    ).toHaveLength(1);
  });

  it("associates a retry failure only with the attempted message", async () => {
    retryError = true;
    retryVariables = { messageId: "failed-target" };
    setMessages([
      {
        id: "failed-target",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "professional",
        messageType: "guidance",
        content: "Falha alvo",
        state: "failed",
        retryable: true,
        createdAt: Date.now(),
      },
      {
        id: "failed-sibling",
        patientUserId: 41,
        direction: "professional_to_patient",
        origin: "professional",
        messageType: "guidance",
        content: "Falha irmã",
        state: "failed",
        retryable: true,
        createdAt: Date.now() + 1,
      },
    ]);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    const articles = screen.getAllByRole("article");
    const target = articles.find(article =>
      article.textContent?.includes("Falha alvo")
    );
    const sibling = articles.find(article =>
      article.textContent?.includes("Falha irmã")
    );
    expect(target?.textContent).toContain(
      "Não foi possível tentar a entrega novamente."
    );
    expect(sibling?.textContent).not.toContain(
      "Não foi possível tentar a entrega novamente."
    );
  });

  it("uses a safe generic patient label in the portfolio inbox", async () => {
    patientSelected = false;
    currentLocation = "/professional/messages";
    setMessages([
      {
        id: "inbox-1",
        patientUserId: 41,
        direction: "patient_to_professional",
        origin: "patient",
        messageType: "response",
        content: "Mensagem sem nome cadastrado",
        state: "received",
        createdAt: Date.now(),
        authorName: null,
        patientName: null,
      },
    ]);
    const { default: Experience } = await import(
      "./ProfessionalMessagesExperience"
    );
    render(<Experience />);

    expect(screen.getByText("Paciente")).toBeTruthy();
    expect(screen.queryByText("Paciente 41")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Abrir conversa" })
    );
    expect(setLocation).toHaveBeenCalledWith(
      "/professional/patients/41/messages"
    );
  });
});
