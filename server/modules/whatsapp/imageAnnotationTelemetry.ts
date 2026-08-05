import type { ImageAnnotationResponse } from "../../_core/imageAnnotation";

export type ImageAnnotationTelemetryState =
  | "local"
  | "external_primary"
  | "external_primary_retry"
  | "external_fallback"
  | "external_to_local"
  | "off"
  | "failed";

export function hasUsableImageAnnotationPayload(
  result: ImageAnnotationResponse | null | undefined,
) {
  return Boolean(result?.url || result?.buffer);
}

export function getImageAnnotationTelemetryState(
  result: ImageAnnotationResponse | null | undefined,
): ImageAnnotationTelemetryState {
  if (!result) return "failed";
  if (result.mode === "off") return "off";
  if (result.degradation === "external_to_local") return "external_to_local";

  if (result.mode === "local" && hasUsableImageAnnotationPayload(result)) {
    return "local";
  }

  if (result.mode === "external" && hasUsableImageAnnotationPayload(result)) {
    if (result.providerSource === "fallback") return "external_fallback";
    if (result.providerSource === "primary_retry") return "external_primary_retry";
    return "external_primary";
  }

  return "failed";
}

export function formatImageAnnotationTelemetry(
  result: ImageAnnotationResponse | null | undefined,
) {
  const state = getImageAnnotationTelemetryState(result);
  return [
    `state=${state}`,
    `mode=${result?.mode ?? "unknown"}`,
    `degradation=${result?.degradation ?? "none"}`,
    `providerSource=${result?.providerSource ?? "none"}`,
    `attempts=${result?.attempts ?? 0}`,
    `skippedReason=${result?.skippedReason ?? "none"}`,
    `hasUrl=${Boolean(result?.url)}`,
    `hasBuffer=${Boolean(result?.buffer)}`,
    `hasStorageKey=${Boolean(result?.storageKey)}`,
  ].join("; ");
}
