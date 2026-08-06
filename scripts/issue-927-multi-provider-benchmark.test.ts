import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  buildReport,
  readTranscriptionEvidence,
  validateManifest,
  type Manifest,
} from "./issue-927-multi-provider-benchmark";

const manifestPath = path.resolve(import.meta.dirname, "../docs/benchmarks/multi-provider/fixtures/manifest.json");
const readManifest = async () => JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
const clone = (value: Manifest) => structuredClone(value);

describe("issue 927 multi-provider benchmark", () => {
  it("covers every capability and required synthetic scenario", async () => {
    const manifest = await readManifest();
    expect(() => validateManifest(manifest)).not.toThrow();
    expect(new Set(manifest.requiredCapabilities)).toEqual(new Set(CAPABILITIES));
    expect(manifest.scenarios).toHaveLength(32);
    expect(manifest.privacy).toBe("synthetic-only");
  });

  it("rejects sensitive content and provider calls in deterministic flows", async () => {
    const sensitive = clone(await readManifest()) as Manifest & { prompt?: string };
    sensitive.prompt = "not allowed";
    expect(() => validateManifest(sensitive)).toThrow(/forbidden sensitive key prompt/);

    const external = clone(await readManifest());
    external.scenarios.find(item => item.deterministic)!.calls = 1;
    expect(() => validateManifest(external)).toThrow(/deterministic flow called a provider/);
  });

  it("rejects unsafe fallback behavior", async () => {
    const parallel = clone(await readManifest());
    parallel.scenarios[0]!.concurrency = 2;
    expect(() => validateManifest(parallel)).toThrow(/provider calls ran in parallel/);

    const afterValid = clone(await readManifest());
    const validPrimary = afterValid.scenarios.find(item => item.id === "meal-simple")!;
    validPrimary.fallback = "same-provider";
    validPrimary.calls = 2;
    expect(() => validateManifest(afterValid)).toThrow(/fell back after a valid primary result/);

    const cross = clone(await readManifest());
    cross.scenarios.find(item => item.fallback === "cross-provider")!.crossApproved = false;
    expect(() => validateManifest(cross)).toThrow(/lacks explicit approval/);
  });

  it("keeps production and every fallback flag disabled", async () => {
    const report = await buildReport({
      manifest: await readManifest(), testedSha: "test", sourceTreeSha256: "tree",
      priceCatalogVersion: "2026-08-05.4", priceCatalogEffectiveDate: "2026-08-05",
      generatedAt: "2026-08-05T00:00:00.000Z",
    });
    expect(report.globalGates.passed).toBe(true);
    expect(report.productionChangesApplied).toBe(false);
    expect(report.rolloutDecision.status).toBe("paused-authorization-required");
    expect(report.promotionDecisions.every(item => !item.fallbackEnabled)).toBe(true);
    expect(report.promotionDecisions.every(item => !item.crossProviderFallbackEnabled)).toBe(true);
    expect(report.promotionDecisions.every(item => !item.productionApplied)).toBe(true);
  });

  it("uses live transcription evidence only for a controlled candidate", async () => {
    const evidence = await readTranscriptionEvidence();
    expect(evidence.status).toBe("available");
    expect(evidence.testedSha).toBe("af087f9b0c643a3146d46c1567c8fd80bbeff03e");
    expect(evidence.decision).toBe("controlled-rollout-candidate");

    const report = await buildReport({
      manifest: await readManifest(), testedSha: "test", sourceTreeSha256: "tree",
      priceCatalogVersion: "2026-08-05.4", priceCatalogEffectiveDate: "2026-08-05",
    });
    expect(report.promotionDecisions.find(item => item.capability === "TRANSCRIPTION")?.primaryModel)
      .toBe("gpt-4o-mini-transcribe");
    expect(report.promotionDecisions.find(item => item.capability === "IMAGE_ANNOTATION")?.decision)
      .toBe("local-mode");
    expect(report.promotionDecisions.find(item => item.capability === "FOOD_CLASSIFICATION")?.decision)
      .toBe("embedded-no-separate-call");
  });
});
