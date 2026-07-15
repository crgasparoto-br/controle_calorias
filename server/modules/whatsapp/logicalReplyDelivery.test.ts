import { beforeEach, describe, expect, it, vi } from "vitest";

const quickEditMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
vi.mock("../quickEdit/service", () => ({ tryCreateQuickEditLinkForMeal: quickEditMock }));
vi.mock("./replyTransport", () => ({ sendWhatsAppLogicalReply: sendMock }));

import { buildWhatsAppLogicalReplyForDelivery, sendWhatsAppLogicalDomainReply } from "./logicalReplyDelivery";
import { listReply } from "./replyContract";

describe("logicalReplyDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quickEditMock.mockResolvedValue({ url: "https://app.test/quick-edit/token" });
    sendMock.mockImplementation(async (_to, reply) => ({ ok: true, primaryOk: true, recorded: true, sends: reply.messages.map((message: unknown) => ({ message, ok: true, detail: "ok" })) }));
  });

  it("compõe texto, CTA e imagem na mesma resposta lógica", async () => {
    const reply = await buildWhatsAppLogicalReplyForDelivery({ userId: 42, mealId: 10, replyText: "Refeição registrada", auxiliaryImage: { url: "https://img.test/a.png", caption: "Imagem anotada" } });
    expect(reply.messages).toEqual([
      { type: "cta_url", bodyText: "Refeição registrada", buttonText: "Editar refeição", url: "https://app.test/quick-edit/token" },
      { type: "image_url", url: "https://img.test/a.png", caption: "Imagem anotada" },
    ]);
    expect(reply.recordText).toBe("Refeição registrada");
  });

  it("não substitui lista por CTA", async () => {
    const logicalReply = listReply("Escolha", "Ver opções", [{ rows: [{ id: "opaque", title: "Arroz" }] }]);
    const reply = await buildWhatsAppLogicalReplyForDelivery({ userId: 42, mealId: 10, replyText: "Escolha", logicalReply });
    expect(reply).toBe(logicalReply);
    expect(quickEditMock).not.toHaveBeenCalled();
  });

  it("mantém o texto quando o link não é gerado", async () => {
    quickEditMock.mockRejectedValue(new Error("quick edit indisponível"));
    const delivery = await sendWhatsAppLogicalDomainReply({ to: "5511999999999", userId: 42, mealId: 10, replyText: "Atualizada", lifecycleHandle: { conversationId: 1, messageId: 2, wasNewInsert: true } });
    expect(delivery.reply.messages).toEqual([{ type: "text", body: "Atualizada" }]);
    expect(sendMock).toHaveBeenCalledOnce();
  });
});
