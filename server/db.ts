import {
  logInferenceEvent as logInferenceEventImplementation,
} from "./dbImplementation";
import { normalizeImageAnnotationInferenceEvent } from "./modules/whatsapp/imageAnnotationTelemetryContext";

export * from "./dbImplementation";

export function logInferenceEvent(
  input: Parameters<typeof logInferenceEventImplementation>[0],
): ReturnType<typeof logInferenceEventImplementation> {
  return logInferenceEventImplementation(
    normalizeImageAnnotationInferenceEvent(input),
  );
}
