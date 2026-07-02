type ReportMetricsEnv = Pick<NodeJS.ProcessEnv, "REPORTS_OBSERVABILITY_ENABLED" | "REPORTS_METRICS_ENABLED">;

type ReportMetricStatus = "success" | "error";

type ReportStageMetric = {
  stage: "meals" | "exercises" | "waterLogs";
  rangeDays: number;
  durationMs: number;
  payloadApproxBytes: number;
  itemCount: number;
  fallbackUsed: boolean;
  status?: ReportMetricStatus;
  errorName?: string;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isEnabledValue(value: string | undefined) {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function clampNonNegativeInteger(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

export function isReportsObservabilityEnabled(env: ReportMetricsEnv = process.env) {
  return isEnabledValue(env.REPORTS_OBSERVABILITY_ENABLED) || isEnabledValue(env.REPORTS_METRICS_ENABLED);
}

export function estimateReportPayloadBytes(payload: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? null), "utf8");
  } catch {
    return 0;
  }
}

export function getReportRangeDays(range: { startDate: string; endDate: string }) {
  const start = new Date(`${range.startDate}T12:00:00.000Z`).getTime();
  const end = new Date(`${range.endDate}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / MS_PER_DAY) + 1;
}

export function logReportStageMetric(metric: ReportStageMetric, env: ReportMetricsEnv = process.env) {
  if (!isReportsObservabilityEnabled(env)) return;

  console.info("[ReportsMetric]", JSON.stringify({
    event: "reports.stage",
    endpoint: "reports.rangeData",
    stage: metric.stage,
    rangeDays: clampNonNegativeInteger(metric.rangeDays),
    durationMs: clampNonNegativeInteger(metric.durationMs),
    payloadApproxBytes: clampNonNegativeInteger(metric.payloadApproxBytes),
    itemCount: clampNonNegativeInteger(metric.itemCount),
    fallbackUsed: Boolean(metric.fallbackUsed),
    status: metric.status ?? "success",
    errorName: metric.errorName,
  }));
}
