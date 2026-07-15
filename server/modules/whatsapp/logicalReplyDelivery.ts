import { tryCreateQuickEditLinkForMeal } from "../quickEdit/service";
import { textReply, withAuxiliaryImage, withCtaUrl, type WhatsAppLogicalReply } from "./replyContract";
import { sendWhatsAppLogicalReply } from "./replyTransport";
import {
  markMessageProcessed,
  recordDomainLink,
  type MessageLifecycleHandle,
} from "./messageLifecycle";
import type { DomainLinkInput } from "../../repositories/whatsappConversationRepository";

export type WhatsAppAuxiliaryImage =
  | { url: string; caption: string }
  | { buffer: Buffer; mimeType?: string; fileName?: string; caption: string };

function canReplacePrimaryWithCta(reply: WhatsAppLogicalReply) {
  return reply.messages[0]?.type === "text";
}

export async function buildWhatsAppLogicalReplyForDelivery(input: {
  userId: number; replyText: string; mealId?: number | null; logicalReply?: WhatsAppLogicalReply; auxiliaryImage?: WhatsAppAuxiliaryImage | null;
}) {
  let reply = input.logicalReply ?? textReply(input.replyText);
  if (input.mealId && canReplacePrimaryWithCta(reply)) {
    try {
      const link = await tryCreateQuickEditLinkForMeal({ userId: input.userId, mealId: input.mealId });
      if (link?.url) reply = withCtaUrl(reply, { buttonText: "Editar refeição", url: link.url });
    } catch {
      // Quick edit is optional; the functional nutrition reply must still be delivered.
    }
  }
  if (input.auxiliaryImage) reply = withAuxiliaryImage(reply, input.auxiliaryImage);
  return reply;
}

export async function sendWhatsAppLogicalDomainReply(input: {
  to: string;
  userId: number;
  replyText: string;
  mealId?: number | null;
  logicalReply?: WhatsAppLogicalReply;
  auxiliaryImage?: WhatsAppAuxiliaryImage | null;
  lifecycleHandle?: MessageLifecycleHandle;
  domainLinks?: DomainLinkInput[];
  /**
   * Finaliza o inbound apenas quando a mensagem funcional primária foi entregue.
   * Notificações sem inbound deixam este campo no padrão `true`, mas não possuem handle.
   */
  finalizeLifecycle?: boolean;
}) {
  const reply = await buildWhatsAppLogicalReplyForDelivery(input);
  const lifecycle = input.lifecycleHandle
    ? { handle: input.lifecycleHandle, userId: input.userId }
    : undefined;
  const result = await sendWhatsAppLogicalReply(input.to, reply, lifecycle);
  if (result.primaryOk && result.recorded && input.lifecycleHandle && input.finalizeLifecycle !== false) {
    for (const link of input.domainLinks ?? []) {
      await recordDomainLink(input.lifecycleHandle, link);
    }
    await markMessageProcessed(input.lifecycleHandle);
  }
  return { reply, result };
}
