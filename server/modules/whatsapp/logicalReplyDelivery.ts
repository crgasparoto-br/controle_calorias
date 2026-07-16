import { tryCreateQuickEditLinkForMeal } from "../quickEdit/service";
import { logicalReplyFromLegacyText, withAuxiliaryImage, withCtaUrl, type WhatsAppLogicalReply } from "./replyContract";
import { sendWhatsAppLogicalReply } from "./replyTransport";
import type { MessageLifecycleHandle } from "./messageLifecycle";

export type WhatsAppAuxiliaryImage =
  | { url: string; caption: string }
  | { buffer: Buffer; mimeType?: string; fileName?: string; caption: string };

function canReplacePrimaryWithCta(reply: WhatsAppLogicalReply) {
  return reply.messages[0]?.type === "text";
}

export async function buildWhatsAppLogicalReplyForDelivery(input: {
  userId: number; replyText: string; mealId?: number | null; logicalReply?: WhatsAppLogicalReply; auxiliaryImage?: WhatsAppAuxiliaryImage | null;
}) {
  let reply = input.logicalReply ?? logicalReplyFromLegacyText(input.replyText);
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
}) {
  const reply = await buildWhatsAppLogicalReplyForDelivery(input);
  const lifecycle = input.lifecycleHandle
    ? { handle: input.lifecycleHandle, userId: input.userId }
    : undefined;
  const result = await sendWhatsAppLogicalReply(input.to, reply, lifecycle);
  return { reply, result };
}


/** Resposta funcional sem usuário/lifecycle, restrita a notificações e orientações sem inbound identificado. */
export async function sendWhatsAppStandaloneLogicalReply(to: string, reply: WhatsAppLogicalReply) {
  const result = await sendWhatsAppLogicalReply(to, reply);
  return { reply, result };
}

export async function sendWhatsAppStandaloneReply(to: string, replyText: string) {
  return sendWhatsAppStandaloneLogicalReply(to, logicalReplyFromLegacyText(replyText));
}
