import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const ISSUE_927_EXTERNAL_CAPABILITIES = [
  "MEAL_TEXT", "MEAL_VISION", "WHATSAPP_INTENT", "QUESTION",
  "NUTRITION_SEARCH", "EMBEDDING", "TRANSCRIPTION", "IMAGE_ANNOTATION",
] as const;
export type Issue927ExternalCapability = (typeof ISSUE_927_EXTERNAL_CAPABILITIES)[number];

export const ISSUE_927_CONTROL_FAMILIES = [
  "fallback-disabled", "retry", "same-provider-fallback", "cross-provider-blocked",
] as const;
export type Issue927ControlFamily = (typeof ISSUE_927_CONTROL_FAMILIES)[number];
export type ProviderId = "openai" | "openai-compatible" | "gemini";
export type Operation = "text" | "embedding" | "audio" | "image";
export type Profile = {
  primaryProvider: ProviderId;
  primaryModel: string;
  fallbackProvider: ProviderId;
  fallbackModel: string;
  operation: Operation;
  compatibleOperations?: string;
  compatibleImageModels?: string;
};
export type PolicyResult = {
  id: string;
  capability: Issue927ExternalCapability;
  family: Issue927ControlFamily;
  passed: boolean;
  state: string;
  calls: number;
  primaryCalls: number;
  fallbackCalls: number;
  maxConcurrency: number;
  primaryProvider: ProviderId;
  primaryModel: string;
  fallbackProvider: ProviderId;
  fallbackModel: string;
  fallbackRequested: boolean;
  fallbackEffectivelyEnabled: boolean;
  crossProviderEnabled: boolean;
  outcomes: string[];
};

export const ISSUE_927_POLICY_PROFILES: Record<Issue927ExternalCapability, Profile> = {
  MEAL_TEXT: { primaryProvider: "openai", primaryModel: "gpt-4.1-mini", fallbackProvider: "gemini", fallbackModel: "gemini-2.5-flash", operation: "text" },
  MEAL_VISION: { primaryProvider: "openai", primaryModel: "gpt-4.1-mini", fallbackProvider: "gemini", fallbackModel: "gemini-2.5-flash", operation: "text" },
  WHATSAPP_INTENT: { primaryProvider: "openai", primaryModel: "gpt-4.1-mini", fallbackProvider: "gemini", fallbackModel: "gemini-2.5-flash", operation: "text" },
  QUESTION: { primaryProvider: "openai", primaryModel: "gpt-4.1-mini", fallbackProvider: "gemini", fallbackModel: "gemini-2.5-flash", operation: "text" },
  NUTRITION_SEARCH: { primaryProvider: "openai", primaryModel: "gpt-4.1-mini", fallbackProvider: "gemini", fallbackModel: "gemini-3.1-pro-preview", operation: "text" },
  EMBEDDING: { primaryProvider: "openai", primaryModel: "text-embedding-3-small", fallbackProvider: "openai-compatible", fallbackModel: "text-embedding-3-small", operation: "embedding", compatibleOperations: "embeddings" },
  TRANSCRIPTION: { primaryProvider: "openai", primaryModel: "whisper-1", fallbackProvider: "openai-compatible", fallbackModel: "whisper-1", operation: "audio", compatibleOperations: "transcription" },
  IMAGE_ANNOTATION: { primaryProvider: "openai", primaryModel: "gpt-image-1", fallbackProvider: "openai-compatible", fallbackModel: "gpt-image-1", operation: "image", compatibleOperations: "image_generation,image_edit", compatibleImageModels: "gpt-image-1" },
};

export type NormalizedPolicyException = {
  capability: string;
  family: string;
  reasonCode:
    | "transport-covered-by-executable-control"
    | "no-approved-cross-provider-candidate"
    | "no-safe-local-degradation"
    | "embedded-no-independent-policy"
    | "canonical-review-not-provider-degradation";
  controlId: string | null;
  manifestReasonIgnored: true;
};

export async function validateIssue927PolicyManifest(
  manifestPath = path.resolve(import.meta.dirname, "../docs/benchmarks/multi-provider/fixtures/manifest.json"),
): Promise<NormalizedPolicyException[]> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    policyMatrix?: Record<string, Record<string, { applicable?: boolean; reason?: string }>>;
    scenarios?: Array<{ id: string; capability: string; tags: string[]; expected?: { calls?: number } }>;
    scenarioFiles?: string[];
  };
  const directory = path.dirname(manifestPath);
  const scenarios = manifest.scenarios ?? (await Promise.all((manifest.scenarioFiles ?? []).map(async file => (
    JSON.parse(await readFile(path.join(directory, file), "utf8")) as NonNullable<typeof manifest.scenarios>
  )))).flat();
  const primary = scenarios.find(item => item.id === "intent-provider-primary" && item.capability === "WHATSAPP_INTENT");
  assert(primary, "WHATSAPP_INTENT requires intent-provider-primary");
  assert(primary.tags.includes("provider-primary"), "intent-provider-primary must be primary");
  assert.equal(primary.expected?.calls, 1, "WHATSAPP_INTENT primary must execute exactly one provider call");

  const normalized: NormalizedPolicyException[] = [];
  for (const [capability, families] of Object.entries(manifest.policyMatrix ?? {})) {
    for (const [family, coverage] of Object.entries(families)) {
      if (coverage.applicable) continue;
      let reasonCode: NormalizedPolicyException["reasonCode"];
      let controlId: string | null = null;
      if (capability === "FOOD_CLASSIFICATION") {
        reasonCode = family === "local-degradation"
          ? "canonical-review-not-provider-degradation"
          : "embedded-no-independent-policy";
      } else if (["retry", "same-provider-fallback", "cross-provider-blocked"].includes(family)) {
        reasonCode = "transport-covered-by-executable-control";
        controlId = `${capability}:${family}`;
      } else if (family === "cross-provider-allowed") {
        reasonCode = "no-approved-cross-provider-candidate";
      } else if (family === "local-degradation") {
        reasonCode = "no-safe-local-degradation";
      } else {
        throw new Error(`${capability}/${family} has no closed technical non-applicability rule`);
      }
      normalized.push({ capability, family, reasonCode, controlId, manifestReasonIgnored: true });
    }
  }
  return normalized;
}
