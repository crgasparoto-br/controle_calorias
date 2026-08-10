import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  ROLLBACK_READINESS,
} from "./issue-927-benchmark/contracts";
import {
  buildReport,
  readManifest,
} from "./issue-927-benchmark/report";

describe("issue 927 rollback readiness", () => {
  it("defines an actionable rollback contract for every capability", () => {
    expect(CAPABILITIES.every(capability => Object.keys(ROLLBACK_READINESS[capability]).length > 0)).toBe(true);
    expect(ROLLBACK_READINESS.MEAL_TEXT.env).toMatchObject({
      AI_MEAL_TEXT_PROVIDER: "openai",
      AI_MEAL_TEXT_MODEL: "gpt-4.1-mini",
      AI_MEAL_TEXT_FALLBACK_ENABLED: "false",
      AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
    });
    expect(ROLLBACK_READINESS.WHATSAPP_INTENT.env).toMatchObject({
      AI_WHATSAPP_INTENT_TIMEOUT_MS: "8000",
      AI_WHATSAPP_INTENT_MAX_ATTEMPTS: "2",
    });
    expect(ROLLBACK_READINESS.EMBEDDING).toMatchObject({
      env: { AI_EMBEDDING_MODEL: "text-embedding-3-small" },
      degradedOrDisabled: expect.stringContaining("non-semantic"),
    });
    expect(ROLLBACK_READINESS.IMAGE_ANNOTATION.env).toMatchObject({
      AI_IMAGE_ANNOTATION_MODE: "local",
      AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE: "off",
    });
    expect(ROLLBACK_READINESS.FOOD_CLASSIFICATION).toMatchObject({
      embeddedIn: ["MEAL_TEXT", "MEAL_VISION"],
    });
  });

  it("publishes the rollback contract in every promotion decision", async () => {
    const manifest = await readManifest();
    const report = await buildReport({
      manifest,
      testedSha: "rollback-readiness-test",
      sourceTreeSha256: "rollback-readiness-tree",
      generatedAt: "2026-08-07T00:00:00.000Z",
    });

    for (const decision of report.promotionDecisions) {
      expect(decision.rollback).toEqual(ROLLBACK_READINESS[decision.capability]);
    }
    expect(report.promotionDecisions.find(item => item.capability === "TRANSCRIPTION")).toMatchObject({
      decision: "keep-baseline",
      primaryModel: "whisper-1",
      fallbackEnabled: false,
      crossProviderFallbackEnabled: false,
    });
  });
});
