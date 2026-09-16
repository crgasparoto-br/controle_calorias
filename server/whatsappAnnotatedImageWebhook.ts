import type { Request, Response } from "express";
import {
  handleWhatsAppWebhookWithAnnotatedImages as handleWhatsAppWebhookWithAnnotatedImagesImplementation,
  __resetWhatsAppAnnotatedImageDeduplicationForTests,
} from "./whatsappAnnotatedImageWebhookImplementation";
import { runWithImageAnnotationTelemetryContext } from "./modules/whatsapp/imageAnnotationTelemetryContext";

export function handleWhatsAppWebhookWithAnnotatedImages(
  req: Request,
  res: Response,
) {
  return runWithImageAnnotationTelemetryContext(
    () => handleWhatsAppWebhookWithAnnotatedImagesImplementation(req, res),
  );
}

export { __resetWhatsAppAnnotatedImageDeduplicationForTests };
