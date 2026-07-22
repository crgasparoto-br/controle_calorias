const SENSITIVE_KEY_PATTERN =
  /(email|phone|telefone|token|secret|password|senha|authorization|cookie|sourceText|transcript|notes|message|pedido|restriction|allergy|weight|height|birth|storageUrl|imageUrl|audioUrl)/i;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{8,}\d/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactSensitiveText(value: string) {
  return value
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(EMAIL_PATTERN, "[email_redacted]")
    .replace(PHONE_PATTERN, "[phone_redacted]")
    .slice(0, 500);
}

export function redactSensitiveValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
    };
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(redactSensitiveValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactSensitiveValue(entry),
      ]),
    );
  }

  return value;
}

function extractDbCauseDetail(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "";
  const { code, errno, sqlState, sqlMessage } = cause as {
    code?: string;
    errno?: number;
    sqlState?: string;
    sqlMessage?: string;
  };
  const parts = [
    code && `code=${code}`,
    errno !== undefined && `errno=${errno}`,
    sqlState && `sqlState=${sqlState}`,
    sqlMessage && `sqlMessage=${redactSensitiveText(sqlMessage)}`,
  ].filter(Boolean);
  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

export function safeLogDetail(value: unknown) {
  if (value instanceof Error) {
    const causeDetail = extractDbCauseDetail((value as { cause?: unknown }).cause);
    return `${value.name}: ${redactSensitiveText(value.message)}${causeDetail}`;
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  try {
    return redactSensitiveText(JSON.stringify(redactSensitiveValue(value)));
  } catch {
    return "Detalhe indisponível.";
  }
}

export function summarizeLlmMessagesForAudit(messages: Array<{ role: string; content: unknown }>) {
  return messages.map(message => ({
    role: message.role,
    contentKind: Array.isArray(message.content) ? "multipart" : typeof message.content,
    contentLength: typeof message.content === "string" ? message.content.length : JSON.stringify(message.content ?? "").length,
  }));
}
