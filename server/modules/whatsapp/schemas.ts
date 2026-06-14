import { z } from "zod";

export const whatsappConnectionSchema = z.object({
  phoneNumber: z.string().min(10).max(32),
  displayName: z.string().max(255).optional(),
});

export const simulateWhatsappInboundMediaSchema = z.object({
  type: z.enum(["audio", "image"]),
  mediaId: z.string().max(160).nullable().optional(),
  mimeType: z.string().max(120).nullable().optional(),
  caption: z.string().max(1000).nullable().optional(),
  transcription: z.string().max(4000).nullable().optional(),
  imageDescription: z.string().max(4000).nullable().optional(),
});

export const simulateWhatsappInboundSchema = z.object({
  text: z.string().optional(),
  media: simulateWhatsappInboundMediaSchema.nullable().optional(),
});

export type WhatsappConnectionInput = z.infer<typeof whatsappConnectionSchema>;
export type SimulateWhatsappInboundInput = z.infer<typeof simulateWhatsappInboundSchema>;
