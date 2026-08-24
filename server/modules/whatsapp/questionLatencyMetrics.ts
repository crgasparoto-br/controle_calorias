export type QuestionLatencyLogEntry = {
  eventType: string;
  detail: string;
  createdAt: number;
};

export type QuestionLatencyPercentiles = {
  schemaVersion: 1;
  capability: "QUESTION";
  flow: "whatsapp_question";
  sampleSize: number;
  successfulSamples: number;
  errors: number;
  timeouts: number;
  p50TotalMs: number | null;
  p90TotalMs: number | null;
  p95TotalMs: number | null;
  windowStartAt: number | null;
  windowEndAt: number | null;
};

type QuestionLatencyPayload = {
  capability?: unknown;
  flow?: unknown;
  total_ms?: unknown;
  outcome?: unknown;
  error_code?: unknown;
};

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * ratio));
  return sorted[rank - 1] ?? null;
}

function parseLatencyPayload(entry: QuestionLatencyLogEntry): QuestionLatencyPayload | null {
  if (entry.eventType !== "whatsapp.ai_question.latency") return null;
  try {
    const parsed = JSON.parse(entry.detail) as QuestionLatencyPayload;
    if (parsed.capability !== "QUESTION" || parsed.flow !== "whatsapp_question") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isTimeoutCode(value: unknown) {
  return typeof value === "string" && /(?:^|[_-])timeout(?:$|[_-])/i.test(value);
}

/**
 * Builds an operator-facing percentile snapshot from the same sanitized
 * per-request latency events emitted by the production QUESTION path.
 * Percentiles use successful requests; errors/timeouts stay visible as
 * separate counters so failures cannot improve latency statistics silently.
 */
export function buildQuestionLatencyPercentiles(
  entries: QuestionLatencyLogEntry[],
): QuestionLatencyPercentiles {
  const samples: Array<{ createdAt: number; totalMs: number | null; outcome: "success" | "error"; timeout: boolean }> = [];

  for (const entry of entries) {
    const payload = parseLatencyPayload(entry);
    if (!payload) continue;
    const outcome = payload.outcome === "success" ? "success" : payload.outcome === "error" ? "error" : null;
    if (!outcome) continue;
    samples.push({
      createdAt: entry.createdAt,
      totalMs: typeof payload.total_ms === "number" && Number.isFinite(payload.total_ms) && payload.total_ms >= 0
        ? payload.total_ms
        : null,
      outcome,
      timeout: outcome === "error" && isTimeoutCode(payload.error_code),
    });
  }

  const successfulDurations = samples
    .filter(sample => sample.outcome === "success" && sample.totalMs !== null)
    .map(sample => sample.totalMs as number);
  const createdAtValues = samples.map(sample => sample.createdAt).filter(Number.isFinite);

  return {
    schemaVersion: 1,
    capability: "QUESTION",
    flow: "whatsapp_question",
    sampleSize: samples.length,
    successfulSamples: successfulDurations.length,
    errors: samples.filter(sample => sample.outcome === "error").length,
    timeouts: samples.filter(sample => sample.timeout).length,
    p50TotalMs: percentile(successfulDurations, 0.5),
    p90TotalMs: percentile(successfulDurations, 0.9),
    p95TotalMs: percentile(successfulDurations, 0.95),
    windowStartAt: createdAtValues.length ? Math.min(...createdAtValues) : null,
    windowEndAt: createdAtValues.length ? Math.max(...createdAtValues) : null,
  };
}
