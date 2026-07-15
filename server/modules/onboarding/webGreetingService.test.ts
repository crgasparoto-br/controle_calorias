import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const sendWhatsAppLogicalReplyMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: getDbMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("../whatsapp/replyTransport", () => ({
  sendWhatsAppLogicalReply: sendWhatsAppLogicalReplyMock,
}));

const { buildWelcomeMessage, sendOnboardingWelcomeWhatsapp } = await import("./webGreetingService");

let nextUserId = 1000;

function freshUserId() {
  return nextUserId++;
}

function makeConnection(userId: number) {
  return {
    id: userId,
    userId,
    phoneNumber: `551198765${userId % 10000}`.slice(0, 13),
    displayName: "Maria Silva",
    status: "active" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const VALID_GOAL_SUMMARY = {
  defaultGoal: { calories: 1800, proteinGrams: 120, carbsGrams: 200, fatGrams: 60 },
  exceptions: [],
  days: [],
  today: { calories: 1800, proteinGrams: 120, carbsGrams: 200, fatGrams: 60 },
  weeklyTotals: { calories: 12600, proteinGrams: 840, carbsGrams: 1400, fatGrams: 420 },
};

describe("buildWelcomeMessage", () => {
  it("usa a mensagem canônica de onboarding sem interpolar dados sensíveis", () => {
    const msg = buildWelcomeMessage("Maria Silva", 1800, "emagrecer");
    expect(msg).toContain("*Bem-vindo ao Controle de Calorias!*");
    expect(msg).not.toContain("Maria");
    expect(msg).not.toContain("1800 kcal");
  });

  it("contém instruções de registro por WhatsApp", () => {
    const msg = buildWelcomeMessage("Bia", 1600, "manter_peso");
    expect(msg).toContain("Registrar refeições por texto, foto ou áudio");
  });

  it("contém instrução sobre plataforma web", () => {
    const msg = buildWelcomeMessage("Bia", 1600, "manter_peso");
    expect(msg).toContain("sistema pela web");
  });

  it("contém dica de formato de mensagem", () => {
    const msg = buildWelcomeMessage("Bia", 1600, "manter_peso");
    expect(msg).toContain("/Quais alimentos têm mais proteína?");
  });
});

describe("sendOnboardingWelcomeWhatsapp", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    sendWhatsAppLogicalReplyMock.mockReset();

    getDbMock.mockResolvedValue(null);
    getUserNutritionGoalMock.mockResolvedValue(VALID_GOAL_SUMMARY);
    sendWhatsAppLogicalReplyMock.mockImplementation(async (_to: string, reply: { messages: unknown[] }) => ({
      ok: true,
      primaryOk: true,
      sends: reply.messages.map(message => ({ message, ok: true, detail: "ok" })),
    }));
  });

  it("envia mensagem para usuário novo com telefone e meta válidos", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));

    await sendOnboardingWelcomeWhatsapp(uid);

    expect(sendWhatsAppLogicalReplyMock).toHaveBeenCalledOnce();
    const [, reply] = sendWhatsAppLogicalReplyMock.mock.calls[0];
    expect(reply.messages).toHaveLength(2);

    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: uid,
      eventType: "whatsapp.welcome_sent",
      status: "success",
    }));
  });

  it("não envia quando usuário não tem telefone vinculado", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(null);

    await sendOnboardingWelcomeWhatsapp(uid);

    expect(sendWhatsAppLogicalReplyMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: uid,
      eventType: "whatsapp.welcome_skipped_no_phone",
      status: "warning",
    }));
  });

  it("não envia quando telefone está desabilitado", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue({ ...makeConnection(uid), status: "disabled" });

    await sendOnboardingWelcomeWhatsapp(uid);

    expect(sendWhatsAppLogicalReplyMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.welcome_skipped_no_phone",
    }));
  });

  it("não envia quando meta calórica é zero", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));
    getUserNutritionGoalMock.mockResolvedValue({
      ...VALID_GOAL_SUMMARY,
      defaultGoal: { ...VALID_GOAL_SUMMARY.defaultGoal, calories: 0 },
    });

    await sendOnboardingWelcomeWhatsapp(uid);

    expect(sendWhatsAppLogicalReplyMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.welcome_skipped_no_goal",
    }));
  });

  it("não envia quando meta calórica não está disponível", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));
    getUserNutritionGoalMock.mockResolvedValue(null);

    await sendOnboardingWelcomeWhatsapp(uid);

    expect(sendWhatsAppLogicalReplyMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.welcome_skipped_no_goal",
    }));
  });

  it("não envia segunda vez para o mesmo usuário (deduplicação)", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));

    await sendOnboardingWelcomeWhatsapp(uid);
    expect(sendWhatsAppLogicalReplyMock).toHaveBeenCalledOnce();

    sendWhatsAppLogicalReplyMock.mockClear();
    logInferenceEventMock.mockClear();

    await sendOnboardingWelcomeWhatsapp(uid);
    expect(sendWhatsAppLogicalReplyMock).not.toHaveBeenCalled();
  });


  it("retoma somente a mensagem pendente após falha parcial", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));
    sendWhatsAppLogicalReplyMock
      .mockResolvedValueOnce({
        ok: false,
        primaryOk: true,
        sends: [
          { ok: true, detail: "ok" },
          { ok: false, detail: "falha na segunda mensagem" },
        ],
      })
      .mockImplementationOnce(async (_to: string, reply: { messages: unknown[] }) => ({
        ok: true,
        primaryOk: true,
        sends: reply.messages.map(message => ({ message, ok: true, detail: "ok" })),
      }));

    await sendOnboardingWelcomeWhatsapp(uid);
    await sendOnboardingWelcomeWhatsapp(uid);

    expect(sendWhatsAppLogicalReplyMock).toHaveBeenCalledTimes(2);
    const [, firstReply] = sendWhatsAppLogicalReplyMock.mock.calls[0];
    const [, retryReply] = sendWhatsAppLogicalReplyMock.mock.calls[1];
    expect(firstReply.messages).toHaveLength(2);
    expect(retryReply.messages).toHaveLength(1);
    expect(retryReply.messages[0].body).toContain("Sua meta nutricional");
  });

  it("registra log de aviso quando provedor WhatsApp retorna erro", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));
    sendWhatsAppLogicalReplyMock.mockResolvedValue({
      primaryOk: false,
      sends: [{ ok: false, detail: "Meta retornou 500 Internal Server Error no envio da resposta automática." }],
    });

    await sendOnboardingWelcomeWhatsapp(uid);

    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.welcome_failed",
      status: "warning",
    }));
  });

  it("não quebra o fluxo quando um erro inesperado é lançado", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));
    sendWhatsAppLogicalReplyMock.mockRejectedValue(new Error("Timeout de rede"));

    await expect(sendOnboardingWelcomeWhatsapp(uid)).resolves.toBeUndefined();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.welcome_error",
      status: "error",
    }));
  });

  it("não expõe número de telefone completo nos logs de evento", async () => {
    const uid = freshUserId();
    const conn = makeConnection(uid);
    getUserWhatsappConnectionMock.mockResolvedValue(conn);

    await sendOnboardingWelcomeWhatsapp(uid);

    for (const call of logInferenceEventMock.mock.calls) {
      const [event] = call;
      expect(event.detail ?? "").not.toContain(conn.phoneNumber);
    }
  });
});
