export type WhatsappOnboardingCompletionErrorCode =
  | "ACCOUNT_AUTHENTICATION_REQUIRED"
  | "ACCOUNT_LINK_UNAVAILABLE"
  | "ONBOARDING_TOKEN_INVALID"
  | "ONBOARDING_CONCURRENT_OPERATION"
  | "ONBOARDING_RECOVERY_MISMATCH"
  | "ONBOARDING_LEAD_CLAIM_LOST"
  | "PROFILE_WRITE_FAILED"
  | "PERSISTENCE_UNAVAILABLE"
  | "ONBOARDING_COMPLETION_FAILED";

export type WhatsappOnboardingPublicError = {
  code: "NOT_FOUND" | "CONFLICT" | "INTERNAL_SERVER_ERROR";
  message: string;
};

const GENERIC_COMPLETION_CONFLICT =
  "Não foi possível concluir o cadastro com estes dados. Se você já possui uma conta, entre nela e retome o vínculo usando o mesmo link do WhatsApp.";
const GENERIC_LINK_CONFLICT =
  "Não foi possível vincular este WhatsApp à conta autenticada. Verifique o link recebido e tente novamente.";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

export function getSafeWhatsappOnboardingCompletionErrorCode(
  error: unknown
): WhatsappOnboardingCompletionErrorCode {
  const message = errorMessage(error);
  if (message === "EMAIL_ALREADY_REGISTERED" || message === "INVALID_CREDENTIALS") {
    return "ACCOUNT_AUTHENTICATION_REQUIRED";
  }
  if (
    message === "WHATSAPP_PHONE_ALREADY_LINKED" ||
    message === "ONBOARDING_ACCOUNT_LINK_UNAVAILABLE"
  ) {
    return "ACCOUNT_LINK_UNAVAILABLE";
  }
  if (message === "INVALID_OR_EXPIRED_ONBOARDING_TOKEN") {
    return "ONBOARDING_TOKEN_INVALID";
  }
  if (message === "ONBOARDING_COMPLETION_IN_PROGRESS") {
    return "ONBOARDING_CONCURRENT_OPERATION";
  }
  if (message === "ONBOARDING_RECOVERY_ACCOUNT_MISMATCH") {
    return "ONBOARDING_RECOVERY_MISMATCH";
  }
  if (message === "ONBOARDING_LEAD_CLAIM_LOST") {
    return "ONBOARDING_LEAD_CLAIM_LOST";
  }
  if (message === "PROFILE_WRITE_FAILED") {
    return "PROFILE_WRITE_FAILED";
  }
  if (message === "DATABASE_UNAVAILABLE") {
    return "PERSISTENCE_UNAVAILABLE";
  }
  return "ONBOARDING_COMPLETION_FAILED";
}

export function getPublicWhatsappOnboardingCompletionError(
  error: unknown
): WhatsappOnboardingPublicError {
  const message = errorMessage(error);
  if (message === "INVALID_OR_EXPIRED_ONBOARDING_TOKEN") {
    return {
      code: "NOT_FOUND",
      message:
        "Link inválido, expirado ou já utilizado. Solicite um novo link pelo WhatsApp.",
    };
  }
  if (message === "ONBOARDING_COMPLETION_IN_PROGRESS") {
    return {
      code: "CONFLICT",
      message:
        "Este cadastro já está sendo concluído. Aguarde alguns instantes e tente novamente.",
    };
  }
  if (
    message === "EMAIL_ALREADY_REGISTERED" ||
    message === "INVALID_CREDENTIALS" ||
    message === "ONBOARDING_RECOVERY_ACCOUNT_MISMATCH"
  ) {
    return { code: "CONFLICT", message: GENERIC_COMPLETION_CONFLICT };
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    message: "Não foi possível concluir o cadastro iniciado pelo WhatsApp.",
  };
}

export function getPublicWhatsappAuthenticatedLinkError(
  error: unknown
): WhatsappOnboardingPublicError {
  const message = errorMessage(error);
  if (message === "INVALID_OR_EXPIRED_ONBOARDING_TOKEN") {
    return {
      code: "NOT_FOUND",
      message:
        "Link inválido, expirado ou já utilizado. Solicite um novo link pelo WhatsApp.",
    };
  }
  if (
    message === "ONBOARDING_COMPLETION_IN_PROGRESS" ||
    message === "ONBOARDING_ACCOUNT_LINK_UNAVAILABLE" ||
    message === "WHATSAPP_PHONE_ALREADY_LINKED"
  ) {
    return { code: "CONFLICT", message: GENERIC_LINK_CONFLICT };
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    message: "Não foi possível vincular o WhatsApp à conta autenticada.",
  };
}
