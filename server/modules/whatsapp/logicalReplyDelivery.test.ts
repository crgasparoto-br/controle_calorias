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

  it("compõe texto, CTA curto e imagem na mesma resposta lógica", async () => {
    const reply = await buildWhatsAppLogicalReplyForDelivery({ userId: 42, mealId: 10, replyText: "Refeição registrada", auxiliaryImage: { url: "https://img.test/a.png", caption: "Imagem anotada" } });
    expect(reply.messages).toEqual([
      { type: "text", body: "Refeição registrada" },
      { type: "cta_url", bodyText: "Precisa ajustar algum alimento?", buttonText: "Editar refeição", url: "https://app.test/quick-edit/token" },
      { type: "image_url", url: "https://img.test/a.png", caption: "Imagem anotada" },
    ]);
    expect(reply.recordText).toBeUndefined();
  });

  it("preserva o resumo canônico como primário sem repeti-lo no CTA", async () => {
    const canonicalReply = "Refeição atualizada\n\n*Meta:* 2.000 kcal\n*Consumo:* 1.850 kcal\n*Déficit:* 150 kcal (-7%)";

    const reply = await buildWhatsAppLogicalReplyForDelivery({ userId: 42, mealId: 10, replyText: canonicalReply });

    expect(reply.messages).toEqual([
      { type: "text", body: canonicalReply },
      { type: "cta_url", bodyText: "Precisa ajustar algum alimento?", buttonText: "Editar refeição", url: "https://app.test/quick-edit/token" },
    ]);
    expect(reply.messages[1]).not.toMatchObject({ bodyText: canonicalReply });
  });

  it("não anexa CTA a uma decisão interativa", async () => {
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
