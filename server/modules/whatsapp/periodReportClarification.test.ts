import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  removeMeal: vi.fn(),
  updateMeal: vi.fn(),
}));

const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");
const { buildWhatsAppCallbackId } = await import("./interactiveCallback");
const {
  buildWhatsappPeriodReportClarificationListReply,
  PENDING_PERIOD_REPORT_TYPE,
  WHATSAPP_PERIOD_REPORT_OPTIONS,
} = await import("./periodReportClarification");
const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");
const { getDb, logPersistenceWarning } = await import("../../db");

const pendingRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

type ListMessage = { type: "list"; bodyText: string; buttonText: string; sections: Array<{ rows: Array<{ id: string; title: string }> }> };

function listRows(reply: unknown) {
  const message = (reply as { messages: ListMessage[] }).messages[0];
  expect(message.type).toBe("list");
  return message.sections.flatMap(section => section.rows);
}

async function createPeriodPending(userId: number) {
  const pending = await pendingRepository.createPendingOperation({
    userId,
    type: PENDING_PERIOD_REPORT_TYPE,
    origin: "test",
    ttlMs: 60_000,
    target: { kind: "period_report" },
  });
  if (!pending) throw new Error("pendência de período não criada");
  return pending;
}

describe("clarificação interativa de período (issues #782/#784/#858)", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    listMealsMock.mockResolvedValue([]);
  });

  it("monta lista com quatro períodos e Cancelar vinculados à mesma pendência", async () => {
    const pending = await createPeriodPending(71_001);
    const reply = buildWhatsappPeriodReportClarificationListReply(pending.id, "Me diga o período.");

    const rows = listRows(reply);
    expect(rows.map(row => row.title)).toEqual([
      ...WHATSAPP_PERIOD_REPORT_OPTIONS.map(option => option.title),
      "Cancelar",
    ]);
    for (const row of rows) {
      expect(row.id).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(row.id).not.toContain("period:");
      expect(row.id).not.toContain(String(pending.id));
    }
  });

  it("seleção por lista resolve a pendência e responde com o resumo do período escolhido", async () => {
    const userId = 71_002;
    const pending = await createPeriodPending(userId);
    const reply = buildWhatsappPeriodReportClarificationListReply(pending.id, "Me diga o período.");
    const todayRow = listRows(reply).find(row => row.title === "Hoje");
    if (!todayRow) throw new Error("opção Hoje não encontrada");

    const result = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: todayRow.id });
    if (result.step !== "interactive_callback") throw new Error("callback não resolvido pelo gate");
    expect(result.result.eventType).toBe("whatsapp.intent.period_report");
    expect(result.result.reply).toContain("Resumo de hoje");
    expect(result.result.reply).not.toContain("Meta estimada");
  });

  it("Cancelar consome a pendência sem gerar resumo", async () => {
    const userId = 71_007;
    const pending = await createPeriodPending(userId);
    const reply = buildWhatsappPeriodReportClarificationListReply(pending.id, "Me diga o período.");
    const cancelRow = listRows(reply).find(row => row.title === "Cancelar");
    if (!cancelRow) throw new Error("opção Cancelar não encontrada");

    const result = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: cancelRow.id });
    if (result.step !== "interactive_callback") throw new Error("callback não resolvido pelo gate");
    expect(result.result.eventType).toBe("whatsapp.interactive_callback.period_report_cancelled");
    expect(result.result.reply).toContain("Não montei o resumo");
    expect(await pendingRepository.getActivePendingOperation(userId)).toBeNull();
  });

  it("reentrega/clique duplo na mesma seleção retorna indisponível sem repetir a resolução", async () => {
    const userId = 71_003;
    const pending = await createPeriodPending(userId);
    const reply = buildWhatsappPeriodReportClarificationListReply(pending.id, "Me diga o período.");
    const yesterdayRow = listRows(reply).find(row => row.title === "Ontem");
    if (!yesterdayRow) throw new Error("opção Ontem não encontrada");

    const first = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: yesterdayRow.id });
    if (first.step !== "interactive_callback") throw new Error("callback não resolvido pelo gate");
    expect(first.result.eventType).toBe("whatsapp.intent.period_report");

    const second = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: yesterdayRow.id });
    if (second.step !== "interactive_callback") throw new Error("callback não resolvido pelo gate");
    expect(second.result.eventType).toBe("whatsapp.interactive_callback.unavailable");
  });

  it("callback de outro usuário não consome a pendência de período", async () => {
    const owner = 71_004;
    const attacker = 71_005;
    const pending = await createPeriodPending(owner);
    const reply = buildWhatsappPeriodReportClarificationListReply(pending.id, "Me diga o período.");
    const row = listRows(reply)[0];

    const result = await resolveWhatsAppPrecedenceGate({ userId: attacker, interactiveReplyId: row.id });
    if (result.step !== "interactive_callback") throw new Error("callback não resolvido pelo gate");
    expect(result.result.eventType).toBe("whatsapp.interactive_callback.unavailable");

    const ownerResult = await resolveWhatsAppPrecedenceGate({ userId: owner, interactiveReplyId: row.id });
    if (ownerResult.step !== "interactive_callback") throw new Error("callback não resolvido pelo gate");
    expect(ownerResult.result.eventType).toBe("whatsapp.intent.period_report");
  });

  it("ação fora do contrato de período retorna indisponível sanitizado", async () => {
    const userId = 71_006;
    const pending = await createPeriodPending(userId);
    const forged = buildWhatsAppCallbackId(pending.id, "period:sempre");

    const result = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: forged });
    if (result.step !== "interactive_callback") throw new Error("callback não resolvido pelo gate");
    expect(result.result.eventType).toBe("whatsapp.interactive_callback.unavailable");
    expect(result.result.reply).not.toContain(String(pending.id));
  });
});
