const SENSITIVE_KEY_PATTERN =
  /(email|phone|telefone|token|secret|password|senha|authorization|cookie|sourceText|transcript|notes|message|pedido|restriction|allergy|weight|height|birth|storageUrl|imageUrl|audioUrl)/i;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{8,}\d/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SAFE_STRUCTURED_STRING_KEYS = new Set([
  "capability",
  "callRole",
  "configuredModel",
  "configuredProvider",
  "degradation",
  "effectiveModel",
  "effectiveProvider",
  "eligibility",
  "executionId",
  "flow",
  "kind",
  "occurredAt",
  "origin",
  "outcome",
  "pricingCatalogVersion",
  "pricingEffectiveDate",
  "reason",
  "tool",
]);

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

function isAiInferenceEventDetail(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const hasKnownCorrelationId =
      typeof parsed.executionId === "string" || typeof parsed.requestId === "string";
    return (parsed?.schemaVersion === 1 || parsed?.schemaVersion === 2)
      && typeof parsed.capability === "string"
      && hasKnownCorrelationId
      && typeof parsed.outcome === "string";
  } catch {
    return false;
  }
}

export function safeLogDetail(value: unknown) {
  if (value instanceof Error) {
    const causeDetail = extractDbCauseDetail((value as { cause?: unknown }).cause);
    return `${value.name}: ${redactSensitiveText(value.message)}${causeDetail}`;
  }

  if (typeof value === "string") {
    return isAiInferenceEventDetail(value)
      ? safeStructuredLogDetail(value)
      : redactSensitiveText(value);
  }

  try {
    return redactSensitiveText(JSON.stringify(redactSensitiveValue(value)));
  } catch {
    return "Detalhe indisponível.";
  }
}

/**
 * Preserves a bounded structured log as valid JSON. This is intentionally
 * separate from `safeLogDetail`, whose 500-character cap remains appropriate
 * for free-form operational messages but would corrupt schema-versioned
 * telemetry when applied after serialization.
 */
export function safeStructuredLogDetail(value: unknown, maxLength = 4_096): string {
  let parsed: unknown;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error("Structured log detail must be valid JSON.");
    }
  } else {
    parsed = value;
  }

  const sanitizeStructuredValue = (candidate: unknown, key?: string): unknown => {
    if (typeof candidate === "string") {
      if (key && SAFE_STRUCTURED_STRING_KEYS.has(key)) {
        return candidate.slice(0, 160);
      }
      return redactSensitiveText(candidate);
    }
    if (Array.isArray(candidate)) {
      return candidate.slice(0, 20).map(item => sanitizeStructuredValue(item));
    }
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>).map(([entryKey, entryValue]) => {
          const safeLatencyMetric =
            entryKey === "time_to_first_token_ms"
            && (entryValue === null || typeof entryValue === "number");
          return [
            entryKey,
            SENSITIVE_KEY_PATTERN.test(entryKey) && !safeLatencyMetric
              ? "[redacted]"
              : sanitizeStructuredValue(entryValue, entryKey),
          ];
        }),
      );
    }
    return candidate;
  };

  const serialized = JSON.stringify(sanitizeStructuredValue(parsed)) ?? "null";
  if (serialized.length > maxLength) {
    throw new Error(`Structured log detail exceeds ${maxLength} characters.`);
  }
  return serialized;
}

export function summarizeLlmMessagesForAudit(messages: Array<{ role: string; content: unknown }>) {
  return messages.map(message => ({
    role: message.role,
    contentKind: Array.isArray(message.content) ? "multipart" : typeof message.content,
    contentLength: typeof message.content === "string" ? message.content.length : JSON.stringify(message.content ?? "").length,
  }));
}
