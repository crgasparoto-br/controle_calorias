import { describe, expect, it } from "vitest";

import {
  evaluateIssue927PolicyControls,
  validateIssue927PolicyManifest,
} from "../../../scripts/issue-927-policy-controls";
import {
  executeScenario,
  readManifest,
} from "../../../scripts/issue-927-multi-provider-benchmark";

describe("issue 927 audit-gap controls", () => {
  it("executes 32 per-capability policy controls through the common resolver and executor", async () => {
    const controls = await evaluateIssue927PolicyControls();
    expect(controls).toHaveLength(32);
    expect(controls.every(control => control.passed)).toBe(true);
    expect(new Set(controls.map(control => control.id)).size).toBe(32);
    expect(controls.every(control => control.maxConcurrency <= 1)).toBe(true);
  });

  it("executes WHATSAPP_INTENT primary through the provider and binds effective provider/model", async () => {
    const manifest = await readManifest();
    const scenario = manifest.scenarios.find(item => item.id === "intent-provider-primary");
    expect(scenario).toBeDefined();
    const result = await executeScenario(scenario!, manifest.rubric.WHATSAPP_INTENT.criticalChecks);
    expect(result.valid).toBe(true);
    expect(result.calls).toBe(1);
    expect(result.attemptDetails).toEqual([
      expect.objectContaining({ role: "primary", provider: "openai", model: "gpt-4.1-mini", outcome: "success" }),
    ]);
  });

  it("rejects circular non-applicability reasons in the benchmark matrix", async () => {
    const normalized = await validateIssue927PolicyManifest();
    expect(normalized.length).toBeGreaterThan(0);
    expect(normalized.every(item => item.manifestReasonIgnored)).toBe(true);
    expect(normalized.filter(item => item.reasonCode === "transport-covered-by-executable-control")
      .every(item => item.controlId?.includes(":"))).toBe(true);
  });
});
