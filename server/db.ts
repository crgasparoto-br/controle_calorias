import {
  getDb as getDbImplementation,
  logInferenceEvent as logInferenceEventImplementation,
} from "./dbImplementation";
import { normalizeImageAnnotationInferenceEvent } from "./modules/whatsapp/imageAnnotationTelemetryContext";
import { getConfiguredBillingDbProvider } from "./repositories/billingRepositorySupport";

export * from "./dbImplementation";

export async function getDb() {
  const billingProvider = getConfiguredBillingDbProvider();
  if (billingProvider && billingProvider !== getDb) {
    return billingProvider();
  }
  return getDbImplementation();
}

export function logInferenceEvent(
  input: Parameters<typeof logInferenceEventImplementation>[0],
): ReturnType<typeof logInferenceEventImplementation> {
  return logInferenceEventImplementation(
    normalizeImageAnnotationInferenceEvent(input),
  );
}
