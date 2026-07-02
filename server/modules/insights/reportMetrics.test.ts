import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateReportPayloadBytes,
  getReportRangeDays,
  isReportsObservabilityEnabled,
  logReportStageMetric,
} from "./reportMetrics";

describe("reports observability metrics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mantém métricas desligadas por padrão", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(isReportsObservabilityEnabled({})).toBe(false);
    logReportStageMetric({
      stage: "meals",
      rangeDays: 7,
      durationMs: 12,
      payloadApproxBytes: 128,
      itemCount: 2,
      fallbackUsed: true,
    }, {});

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("emite métrica estruturada sem dados de usuário quando habilitada", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const payload = [{ id: 1, calories: 120 }];

    logReportStageMetric({
      stage: "meals",
      rangeDays: getReportRangeDays({ startDate: "2026-06-01", endDate: "2026-06-02" }),
      durationMs: 12.4,
      payloadApproxBytes: estimateReportPayloadBytes(payload),
      itemCount: payload.length,
      fallbackUsed: true,
    }, { REPORTS_OBSERVABILITY_ENABLED: "true" });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [prefix, serializedMetric] = infoSpy.mock.calls[0];
    expect(prefix).toBe("[ReportsMetric]");
    expect(typeof serializedMetric).toBe("string");

    const metric = JSON.parse(String(serializedMetric));
    expect(metric).toMatchObject({
      event: "reports.stage",
      endpoint: "reports.rangeData",
      stage: "meals",
      rangeDays: 2,
      durationMs: 12,
      payloadApproxBytes: estimateReportPayloadBytes(payload),
      itemCount: 1,
      fallbackUsed: true,
      status: "success",
    });
    expect(JSON.stringify(metric)).not.toContain("userId");
  });

  it("aceita alias de flag para métricas de relatório", () => {
    expect(isReportsObservabilityEnabled({ REPORTS_METRICS_ENABLED: "1" })).toBe(true);
  });
});
