import type { Request, Response } from "express";
import {
  __resetWhatsAppWebhookDeduplicationForTests,
  handleWhatsAppWebhook as handleWhatsAppWebhookImplementation,
  verifyWhatsAppWebhook,
} from "./whatsappWebhookImplementation";
import { runWithImageAnnotationTelemetryContext } from "./modules/whatsapp/imageAnnotationTelemetryContext";

export {
  __resetWhatsAppWebhookDeduplicationForTests,
  verifyWhatsAppWebhook,
};

export function handleWhatsAppWebhook(req: Request, res: Response) {
  return runWithImageAnnotationTelemetryContext(
    () => handleWhatsAppWebhookImplementation(req, res),
  );
}
