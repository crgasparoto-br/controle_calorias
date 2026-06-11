import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const sendWhatsAppTextMessageMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: getDbMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("../whatsapp/webhookUtils", () => ({
  sendWhatsAppTextMessage: sendWhatsAppTextMessageMock,
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
  it("substitui nome, meta e objetivo corretamente", () => {
    const msg = buildWelcomeMessage("Maria Silva", 1800, "emagrecer");
    expect(msg).toContain("Olá, Maria!");
    expect(msg).toContain("1800 kcal");
    expect(msg).toContain("Perder peso");
  });

  it("usa apenas o primeiro nome", () => {
    const msg = buildWelcomeMessage("João Pedro Santos", 2000, "manter_peso");
    expect(msg).toContain("Olá, João!");
    expect(msg).not.toContain("Pedro");
  });

  it("usa fallback amigável quando nome é nulo", () => {
    const msg = buildWelcomeMessage(null, 1500, "ganhar_massa");
    expect(msg).toContain("Olá, tudo bem!");
  });

  it("usa fallback amigável quando nome é string vazia", () => {
    const msg = buildWelcomeMessage("", 1500, "melhorar_habitos");
    expect(msg).toContain("Olá, tudo bem!");
  });

  it("arredonda a meta calórica para inteiro", () => {
    const msg = buildWelcomeMessage("Ana", 1823.7, "emagrecer");
    expect(msg).toContain("1824 kcal");
  });

  it("exibe 'Não informado' quando objetivo é nulo", () => {
    const msg = buildWelcomeMessage("Carlos", 2100, null);
    expect(msg).toContain("Não informado");
  });

  it("exibe 'Não informado' quando objetivo não está no mapa", () => {
    const msg = buildWelcomeMessage("Carlos", 2100, "objetivo_inexistente");
    expect(msg).toContain("Não informado");
  });

  it("contém instruções de registro por WhatsApp", () => {
    const msg = buildWelcomeMessage("Bia", 1600, "manter_peso");
    expect(msg).toContain("Café da manhã");
    expect(msg).toContain("Almoço");
  });

  it("contém instrução sobre plataforma web", () => {
    const msg = buildWelcomeMessage("Bia", 1600, "manter_peso");
    expect(msg).toContain("plataforma web");
  });

  it("contém dica de formato de mensagem", () => {
    const msg = buildWelcomeMessage("Bia", 1600, "manter_peso");
    expect(msg).toContain("150g de arroz");
  });

  it("mapeia objetivo 'Manter o peso' corretamente", () => {
    const msg = buildWelcomeMessage("Test", 2000, "manter_peso");
    expect(msg).toContain("Manter o peso");
  });

  it("mapeia objetivo 'Ganhar massa muscular' corretamente", () => {
    const msg = buildWelcomeMessage("Test", 2500, "ganhar_massa");
    expect(msg).toContain("Ganhar massa muscular");
  });

  it("mapeia objetivo 'Melhorar os hábitos alimentares' corretamente", () => {
    const msg = buildWelcomeMessage("Test", 2000, "melhorar_habitos");
    expect(msg).toContain("Melhorar os hábitos alimentares");
  });
});

describe("sendOnboardingWelcomeWhatsapp", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    sendWhatsAppTextMessageMock.mockReset();

    getDbMock.mockResolvedValue(null);
    getUserNutritionGoalMock.mockResolvedValue(VALID_GOAL_SUMMARY);
    sendWhatsAppTextMessageMock.mockResolvedValue({ ok: true, detail: "ok" });
  });

  it("envia mensagem para usuário novo com telefone e meta válidos", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));

    await sendOnboardingWelcomeWhatsapp(uid);

    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledOnce();
    const [, body] = sendWhatsAppTextMessageMock.mock.calls[0];
    expect(body).toContain("1800 kcal");

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

    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
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

    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
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

    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.welcome_skipped_no_goal",
    }));
  });

  it("não envia quando meta calórica não está disponível", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));
    getUserNutritionGoalMock.mockResolvedValue(null);

    await sendOnboardingWelcomeWhatsapp(uid);

    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.welcome_skipped_no_goal",
    }));
  });

  it("não envia segunda vez para o mesmo usuário (deduplicação)", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));

    await sendOnboardingWelcomeWhatsapp(uid);
    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledOnce();

    sendWhatsAppTextMessageMock.mockClear();
    logInferenceEventMock.mockClear();

    await sendOnboardingWelcomeWhatsapp(uid);
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
  });

  it("registra log de aviso quando provedor WhatsApp retorna erro", async () => {
    const uid = freshUserId();
    getUserWhatsappConnectionMock.mockResolvedValue(makeConnection(uid));
    sendWhatsAppTextMessageMock.mockResolvedValue({
      ok: false,
      detail: "Meta retornou 500 Internal Server Error no envio da resposta automática.",
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
    sendWhatsAppTextMessageMock.mockRejectedValue(new Error("Timeout de rede"));

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
