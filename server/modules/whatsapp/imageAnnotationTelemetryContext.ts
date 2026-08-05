import { AsyncLocalStorage } from "node:async_hooks";
import type { ImageAnnotationResponse } from "../../_core/imageAnnotation";
import {
  formatImageAnnotationTelemetry,
  hasUsableImageAnnotationPayload,
} from "./imageAnnotationTelemetry";

type ImageAnnotationTelemetryContext = {
  result: ImageAnnotationResponse | null;
};

type InferenceEventInput = {
  eventType: string;
  detail: string;
  [key: string]: unknown;
};

const imageAnnotationTelemetryStorage =
  new AsyncLocalStorage<ImageAnnotationTelemetryContext>();

export function runWithImageAnnotationTelemetryContext<T>(
  operation: () => T,
): T {
  return imageAnnotationTelemetryStorage.run({ result: null }, operation);
}

export function recordImageAnnotationResult(result: ImageAnnotationResponse) {
  const context = imageAnnotationTelemetryStorage.getStore();
  if (context) context.result = result;
  return result;
}

export function normalizeImageAnnotationInferenceEvent<T extends InferenceEventInput>(
  input: T,
): T {
  if (!input.eventType.startsWith("whatsapp.annotated_image_")) {
    return input;
  }

  const result = imageAnnotationTelemetryStorage.getStore()?.result;
  if (!result) return input;

  const telemetry = formatImageAnnotationTelemetry(result);
  if (
    input.eventType === "whatsapp.annotated_image_skipped"
    && hasUsableImageAnnotationPayload(result)
  ) {
    return {
      ...input,
      eventType: "whatsapp.annotated_image_not_persisted",
      detail: `Imagem anotada disponível para envio, mas não vinculada à refeição. ${telemetry}`,
    } as T;
  }

  const detailByEvent: Record<string, string> = {
    "whatsapp.annotated_image_sent": "Imagem anotada enviada pelo WhatsApp.",
    "whatsapp.annotated_image_reply_failed": "Resposta nutricional enviada, mas a imagem auxiliar falhou.",
    "whatsapp.annotated_image_skipped": "Imagem anotada não enviada; resposta nutricional preservada.",
    "whatsapp.annotated_image_not_persisted": "Imagem anotada disponível para envio, mas não vinculada à refeição.",
  };
  const detail = detailByEvent[input.eventType];
  if (!detail) return input;

  return {
    ...input,
    detail: `${detail} ${telemetry}`,
  } as T;
}
