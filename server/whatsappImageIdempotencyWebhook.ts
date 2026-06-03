import { Request, Response } from "express";
import { handleWhatsAppWebhookWithTextIntent } from "./whatsappIntentWebhook";

export async function handleWhatsAppWebhookWithImageIdempotency(req: Request, res: Response) {
  return handleWhatsAppWebhookWithTextIntent(req, res);
}

export function __resetWhatsAppImageIdempotencyForTests() {
  // Test helper intentionally empty until idempotency guard is wired.
}
