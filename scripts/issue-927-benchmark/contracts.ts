import type { AiWebSearchResult } from "../../server/_core/aiProvider";
import type {
  AiNonRetryableErrorCode,
  AiOperationalErrorCode,
} from "../../server/_core/ai/policyExecutor";

export const CAPABILITIES = [
  "MEAL_TEXT",
  "MEAL_VISION",
  "WHATSAPP_INTENT",
  "QUESTION",
  "NUTRITION_SEARCH",
  "EMBEDDING",
  "TRANSCRIPTION",
  "IMAGE_ANNOTATION",
  "FOOD_CLASSIFICATION",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type Runner =
  | "meal"
  | "intent"
  | "conversation"
  | "question"
  | "nutrition-search"
  | "embedding"
  | "transcription"
  | "annotation";
export type ProviderId = "openai" | "openai-compatible" | "gemini";
export type ProviderOperation = "text" | "embedding" | "audio" | "image";
export type FallbackKind = "none" | "same-provider" | "cross-provider";

export const POLICY_FAMILIES = [
  "primary",
  "retry",
  "same-provider-fallback",
  "cross-provider-blocked",
  "cross-provider-allowed",
  "local-degradation",
] as const;
export type PolicyFamily = (typeof POLICY_FAMILIES)[number];

export type PolicyCoverage = {
  applicable: boolean;
  scenarioIds: string[];
  reason?: string;
};

export type UsageFixture = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ProviderStep = {
  operation: ProviderOperation;
  delayMs?: number;
  error?: {
    code: AiOperationalErrorCode | AiNonRetryableErrorCode;
    retryable?: boolean;
  };
  result?: {
    json?: unknown;
    text?: string;
    webSearch?: AiWebSearchResult;
    vectors?: number[][];
    mode?: "catalog-banana";
    language?: string;
    duration?: number;
    syntheticImage?: boolean;
    usage?: UsageFixture;
  };
};

export type Expected = {
  outcome: "success" | "unavailable" | "no-match" | "disabled";
  itemCount?: number;
  foodName?: string;
  foodNameContains?: string;
  brand?: string | null;
  quantity?: number;
  unit?: string;
  gramsPerServing?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  classification?: string;
  intent?: string;
  source?: string;
  textContains?: string;
  webSearchExecuted?: boolean;
  sourceCount?: number;
  verifiedSource?: boolean;
  attempts?: number;
  fallback?: FallbackKind;
  calls?: number;
  geminiCalls?: number;
  mode?: "local" | "external" | "off";
  localDegradation?: boolean;
};

export type Scenario = {
  id: string;
  capability: Capability;
  runner: Runner;
  tags: string[];
  env?: Record<string, string>;
  input: Record<string, unknown>;
  providerPlan?: Partial<Record<ProviderId, ProviderStep[]>>;
  expected: Expected;
  crossProviderApproved?: boolean;
};

export type Manifest = {
  schemaVersion: 3;
  generatedAt: string;
  privacy: "synthetic-only";
  license: string;
  rubricVersion: string;
  requiredCapabilities: Capability[];
  requiredTags: string[];
  rubric: Record<Capability, { validOperation: string; criticalChecks: string[] }>;
  policyMatrix: Record<Capability, Record<PolicyFamily, PolicyCoverage>>;
  scenarios: Scenario[];
};

export type ProviderCall = {
  provider: ProviderId;
  operation: ProviderOperation;
  model: string;
  startedAt: number;
  endedAt: number;
  failed: boolean;
};

export type CheckResult = {
  name: string;
  passed: boolean;
  category: "functional" | "safety";
};

export type ScenarioObservation = {
  id: string;
  capability: Capability;
  tags: string[];
  valid: boolean;
  checks: CheckResult[];
  criticalPassed: number;
  criticalTotal: number;
  falsePositive: boolean;
  source: "not-required" | "verified" | "unverified";
  latencyMs: number;
  timedOut: boolean;
  unavailable: boolean;
  attempts: number;
  fallback: FallbackKind;
  localDegradation: boolean;
  calls: number;
  providerCalls: Record<ProviderId, number>;
  attemptDetails: Array<{
    role: "primary" | "retry" | "fallback" | "escalation";
    provider: ProviderId | null;
    model: string | null;
    outcome: string;
  }>;
  fallbackCalls: number;
  maxConcurrency: number;
  deterministic: boolean;
  toolExecuted: boolean;
  toolUnits: number;
  estimatedCostUsd: number | null;
  safetyRegression: boolean;
  privacyRegression: boolean;
};

export const BASELINE: Record<Capability, { provider: string | null; model: string | null }> = {
  MEAL_TEXT: { provider: "openai", model: "gpt-4.1-mini" },
  MEAL_VISION: { provider: "openai", model: "gpt-4.1-mini" },
  WHATSAPP_INTENT: { provider: "openai", model: "gpt-4.1-mini" },
  QUESTION: { provider: "openai", model: "gpt-4.1-mini" },
  NUTRITION_SEARCH: { provider: "openai", model: "gpt-4.1-mini" },
  EMBEDDING: { provider: "openai", model: "text-embedding-3-small" },
  TRANSCRIPTION: { provider: "openai", model: "whisper-1" },
  IMAGE_ANNOTATION: { provider: null, model: "local" },
  FOOD_CLASSIFICATION: { provider: null, model: "embedded-in-meal-structured-output" },
};

export const ROLLBACK_READINESS = {
  MEAL_TEXT: {
    env: {
      AI_MEAL_TEXT_PROVIDER: "openai",
      AI_MEAL_TEXT_MODEL: "gpt-4.1-mini",
      AI_MEAL_TEXT_TIMEOUT_MS: "30000",
      AI_MEAL_TEXT_MAX_ATTEMPTS: "1",
      AI_MEAL_TEXT_FALLBACK_ENABLED: "false",
      AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
    },
    trigger: "critical meal extraction, valid-result, security/privacy or approved cost/latency gate regression",
    postRollbackSmoke: "synthetic simple plus ambiguous/adversarial meal text; valid items:[] must not cause another call",
    degradedOrDisabled: "no external fallback; controlled unavailability when disabled",
  },
  MEAL_VISION: {
    env: {
      AI_MEAL_VISION_PROVIDER: "openai",
      AI_MEAL_VISION_MODEL: "gpt-4.1-mini",
      AI_MEAL_VISION_TIMEOUT_MS: "30000",
      AI_MEAL_VISION_MAX_ATTEMPTS: "1",
      AI_MEAL_VISION_FALLBACK_ENABLED: "false",
      AI_MEAL_VISION_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
    },
    trigger: "critical vision/NOVA, valid-no-food, second-send or privacy regression",
    postRollbackSmoke: "synthetic photo with food plus no-food functional result without fallback",
    degradedOrDisabled: "preserve baseline/controlled vision failure without second provider",
  },
  WHATSAPP_INTENT: {
    env: {
      AI_WHATSAPP_INTENT_PROVIDER: "openai",
      AI_WHATSAPP_INTENT_MODEL: "gpt-4.1-mini",
      AI_WHATSAPP_INTENT_TIMEOUT_MS: "8000",
      AI_WHATSAPP_INTENT_MAX_ATTEMPTS: "2",
      AI_WHATSAPP_INTENT_FALLBACK_ENABLED: "false",
      AI_WHATSAPP_INTENT_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
    },
    trigger: "deterministic/pending flow calls LLM, idempotency/isolation/correlation or critical intent regression",
    postRollbackSmoke: "deterministic zero-outbound plus pending/correction/replacement/deletion",
    degradedOrDisabled: "no fallback workaround; do not consume pending state or duplicate mutation",
  },
  QUESTION: {
    env: {
      AI_QUESTION_PROVIDER: "openai",
      AI_QUESTION_MODEL: "gpt-4.1-mini",
      AI_QUESTION_TIMEOUT_MS: "30000",
      AI_QUESTION_MAX_ATTEMPTS: "1",
      AI_QUESTION_FALLBACK_ENABLED: "false",
      AI_QUESTION_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
      AI_QUESTION_WEB_SEARCH_MODE: "auto",
    },
    trigger: "read-only/tool/cost/fallback/privacy regression",
    postRollbackSmoke: "slash question without search plus question with optional auto web search",
    degradedOrDisabled: "controlled read-only unavailability; no second provider",
  },
  NUTRITION_SEARCH: {
    env: {
      AI_NUTRITION_SEARCH_PROVIDER: "openai",
      AI_NUTRITION_SEARCH_MODEL: "gpt-4.1-mini",
      AI_NUTRITION_SEARCH_TIMEOUT_MS: "30000",
      AI_NUTRITION_SEARCH_MAX_ATTEMPTS: "1",
      AI_NUTRITION_SEARCH_FALLBACK_ENABLED: "false",
      AI_NUTRITION_SEARCH_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
    },
    trigger: "unverifiable source, ambiguous product promotion, fabricated evidence or external fallback for safe-no-match",
    postRollbackSmoke: "verified-source result plus ambiguous/no-evidence safe-no-match",
    degradedOrDisabled: "canonical nutrition fallback only; never label estimate as researched data",
  },
  EMBEDDING: {
    env: {
      AI_EMBEDDING_PROVIDER: "openai",
      AI_EMBEDDING_MODEL: "text-embedding-3-small",
      AI_EMBEDDING_TIMEOUT_MS: "30000",
      AI_EMBEDDING_MAX_ATTEMPTS: "1",
      AI_EMBEDDING_FALLBACK_ENABLED: "false",
      AI_EMBEDDING_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
    },
    trigger: "embedding contract/vector-space or canonical degradation regression",
    postRollbackSmoke: "synthetic embedding plus forced-unavailable non-semantic search degradation",
    degradedOrDisabled: "canonical textual/non-semantic search; no provider fallback",
  },
  TRANSCRIPTION: {
    env: {
      AI_TRANSCRIPTION_PROVIDER: "openai",
      AI_TRANSCRIPTION_MODEL: "whisper-1",
      AI_TRANSCRIPTION_TIMEOUT_MS: "30000",
      AI_TRANSCRIPTION_MAX_ATTEMPTS: "1",
      AI_TRANSCRIPTION_FALLBACK_ENABLED: "false",
      AI_TRANSCRIPTION_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
    },
    trigger: "useful-text/PT-BR/idempotency/security/privacy or approved cost/latency gate regression",
    postRollbackSmoke: "synthetic PT-BR food audio plus duplicate callback without duplicate mutation",
    degradedOrDisabled: "keep whisper-1 when degraded; controlled failure without empty record/pending consumption when disabled",
  },
  IMAGE_ANNOTATION: {
    env: {
      AI_IMAGE_ANNOTATION_MODE: "local",
      AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE: "off",
      AI_IMAGE_ANNOTATION_FALLBACK_ENABLED: "false",
      AI_IMAGE_ANNOTATION_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
    },
    trigger: "original/derived separation, unauthorized second send, meal-blocking or privacy regression",
    postRollbackSmoke: "synthetic local annotation preserving original plus off mode without external call",
    degradedOrDisabled: "prefer local degradation; off/disabled completes without annotation and never blocks the meal",
  },
  FOOD_CLASSIFICATION: {
    env: {},
    embeddedIn: ["MEAL_TEXT", "MEAL_VISION"],
    trigger: "independent external classification call appears or embedded NOVA contract regresses",
    postRollbackSmoke: "covered by MEAL_TEXT and MEAL_VISION smokes",
    degradedOrDisabled: "inherits the producing capability state",
  },
} satisfies Record<Capability, Record<string, unknown>>;

const FORBIDDEN_REPORT_KEYS = new Set([
  "prompt", "inputtext", "outputtext", "transcript", "audio", "image", "media",
  "base64", "raw", "response", "reasoning", "authorization", "apikey", "secret",
  "signedurl", "cookie", "header",
]);
const FORBIDDEN_FIXTURE_KEYS = new Set([
  "authorization", "apikey", "secret", "accesstoken", "refreshtoken", "cookie",
  "signedurl", "phonenumber", "userid",
]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE_PATTERN = /(?<![A-Za-z0-9])(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}(?![A-Za-z0-9])/u;
const SECRET_PATTERN = /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{12,}|gh[opsu]_[A-Za-z0-9]{20,})\b/u;
const DATA_URL_PATTERN = /data:(?:image|audio|video)\/[^;,]+;base64,/iu;

function scanFixtureSafety(value: unknown, at = "manifest"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanFixtureSafety(item, `${at}[${index}]`));
    return;
  }
  if (typeof value === "string") {
    if (EMAIL_PATTERN.test(value)) throw new Error(`${at} contains an email-like value`);
    if (PHONE_PATTERN.test(value)) throw new Error(`${at} contains a phone-like value`);
    if (SECRET_PATTERN.test(value)) throw new Error(`${at} contains a secret-like value`);
    if (DATA_URL_PATTERN.test(value)) throw new Error(`${at} contains embedded media`);
    if (value.length > 8_000) throw new Error(`${at} contains an oversized string`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIXTURE_KEYS.has(key.toLowerCase())) {
      throw new Error(`${at} contains forbidden fixture key ${key}`);
    }
    scanFixtureSafety(nested, `${at}.${key}`);
  }
}

export function scanReportSafety(value: unknown, at = "report"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanReportSafety(item, `${at}[${index}]`));
    return;
  }
  if (typeof value === "string") {
    if (EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value) || SECRET_PATTERN.test(value) || DATA_URL_PATTERN.test(value)) {
      throw new Error(`${at} contains sensitive-looking content`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEYS.has(key.toLowerCase())) throw new Error(`${at} contains forbidden report key ${key}`);
    scanReportSafety(nested, `${at}.${key}`);
  }
}

export function validateManifest(manifest: Manifest): void {
  scanFixtureSafety(manifest);
  if (manifest.schemaVersion !== 3 || manifest.rubricVersion !== "2026-08-06.4") {
    throw new Error("unsupported benchmark contract");
  }
  if (manifest.privacy !== "synthetic-only" || !manifest.license.trim()) {
    throw new Error("benchmark fixtures must be synthetic and licensed");
  }
  if (new Set(manifest.requiredCapabilities).size !== CAPABILITIES.length) {
    throw new Error("required capability list is incomplete or duplicated");
  }
  for (const capability of CAPABILITIES) {
    const definition = manifest.rubric[capability];
    if (!definition?.validOperation.trim() || definition.criticalChecks.length === 0) {
      throw new Error(`missing versioned rubric for ${capability}`);
    }
  }

  const ids = new Set<string>();
  const capabilities = new Set<Capability>();
  const tags = new Set<string>();
  for (const scenario of manifest.scenarios) {
    if (!scenario.id.trim() || ids.has(scenario.id)) throw new Error("scenario IDs must be unique");
    if (!CAPABILITIES.includes(scenario.capability)) throw new Error(`${scenario.id} has unknown capability`);
    if (!scenario.tags.length) throw new Error(`${scenario.id} has no coverage tags`);
    if (!Number.isInteger(scenario.expected.calls) || (scenario.expected.calls ?? -1) < 0) {
      throw new Error(`${scenario.id} must declare a non-negative expected outbound call count`);
    }
    if (scenario.providerPlan) {
      for (const [provider, steps] of Object.entries(scenario.providerPlan)) {
        if (!(["openai", "openai-compatible", "gemini"] as string[]).includes(provider)) {
          throw new Error(`${scenario.id} has unknown provider plan`);
        }
        for (const step of steps ?? []) {
          if (Boolean(step.error) === Boolean(step.result)) {
            throw new Error(`${scenario.id} provider step must have exactly one result or error`);
          }
        }
      }
    }
    if (scenario.tags.includes("cross-provider-allowed") && !scenario.crossProviderApproved) {
      throw new Error(`${scenario.id} cross-provider fixture lacks explicit approval`);
    }
    ids.add(scenario.id);
    capabilities.add(scenario.capability);
    scenario.tags.forEach(tag => tags.add(tag));
  }
  for (const capability of manifest.requiredCapabilities) {
    if (!capabilities.has(capability)) throw new Error(`missing capability ${capability}`);
  }
  for (const tag of manifest.requiredTags) {
    if (!tags.has(tag)) throw new Error(`missing coverage tag ${tag}`);
  }

  const scenariosById = new Map(manifest.scenarios.map(scenario => [scenario.id, scenario]));
  for (const capability of CAPABILITIES) {
    const policy = manifest.policyMatrix[capability];
    if (!policy) throw new Error(`missing policy matrix for ${capability}`);
    const policyKeys = Object.keys(policy).sort();
    const expectedKeys = [...POLICY_FAMILIES].sort();
    if (JSON.stringify(policyKeys) !== JSON.stringify(expectedKeys)) {
      throw new Error(`policy matrix for ${capability} must declare every policy family exactly once`);
    }
    for (const family of POLICY_FAMILIES) {
      const coverage = policy[family];
      if (coverage.applicable && coverage.scenarioIds.length === 0) {
        throw new Error(`${capability}/${family} is applicable without a scenario`);
      }
      if (!coverage.applicable && (!coverage.reason?.trim() || coverage.scenarioIds.length > 0)) {
        throw new Error(`${capability}/${family} must declare a reason and no scenarios when not applicable`);
      }
      for (const scenarioId of coverage.scenarioIds) {
        const scenario = scenariosById.get(scenarioId);
        if (!scenario) throw new Error(`${capability}/${family} references unknown scenario ${scenarioId}`);
        if (scenario.capability !== capability) {
          throw new Error(`${capability}/${family} references scenario from ${scenario.capability}`);
        }
        if (!scenario.tags.includes(family)) {
          throw new Error(`${capability}/${family} references scenario without matching policy tag ${scenarioId}`);
        }
      }
    }
  }

  for (const scenario of manifest.scenarios) {
    for (const family of POLICY_FAMILIES) {
      if (!scenario.tags.includes(family)) continue;
      const coverage = manifest.policyMatrix[scenario.capability][family];
      if (!coverage.applicable || !coverage.scenarioIds.includes(scenario.id)) {
        throw new Error(`${scenario.id} is not governed by ${scenario.capability}/${family}`);
      }
    }
  }
}
