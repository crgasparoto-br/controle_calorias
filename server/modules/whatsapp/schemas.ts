import { z } from "zod";

export const whatsappConnectionSchema = z.object({
  phoneNumber: z.string().min(10).max(32),
  displayName: z.string().max(255).optional(),
});

export const simulateWhatsappInboundSchema = z.object({
  text: z.string().optional(),
  messageId: z.string().min(1).max(255).optional(),
  receivedAt: z.coerce.date().optional(),
  pendingContextKind: z.enum(["selection", "quantity", "confirmation", "professional_decision"]).optional(),
});

export type WhatsappConnectionInput = z.infer<typeof whatsappConnectionSchema>;
export type SimulateWhatsappInboundInput = z.infer<typeof simulateWhatsappInboundSchema>;
