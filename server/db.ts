import {
  getDb as getDbImplementation,
  getUserIdByWhatsappPhone as getUserIdByWhatsappPhoneImplementation,
  logInferenceEvent as logInferenceEventImplementation,
} from "./dbImplementation";
import { normalizeImageAnnotationInferenceEvent } from "./modules/whatsapp/imageAnnotationTelemetryContext";
import { getConfiguredBillingDbProvider } from "./repositories/billingRepositorySupport";
import {
  beginCurrentQuestionLatencyPreTrace,
  measureCurrentQuestionDbOperation,
} from "./modules/whatsapp/questionLatencyContext";

export * from "./dbImplementation";

export function getDb(): ReturnType<typeof getDbImplementation> {
  const billingProvider = getConfiguredBillingDbProvider();
  if (billingProvider && billingProvider !== getDb) {
    return billingProvider() as ReturnType<typeof getDbImplementation>;
  }
  return getDbImplementation();
}

export function getUserIdByWhatsappPhone(
  phoneNumber: string,
): ReturnType<typeof getUserIdByWhatsappPhoneImplementation> {
  beginCurrentQuestionLatencyPreTrace();
  return measureCurrentQuestionDbOperation(() =>
    getUserIdByWhatsappPhoneImplementation(phoneNumber)
  );
}

export function logInferenceEvent(
  input: Parameters<typeof logInferenceEventImplementation>[0],
): ReturnType<typeof logInferenceEventImplementation> {
  return logInferenceEventImplementation(
    normalizeImageAnnotationInferenceEvent(input),
  );
}
