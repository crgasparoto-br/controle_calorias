import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASELINE,
  CAPABILITIES,
  POLICY_FAMILIES,
  ROLLBACK_READINESS,
  scanReportSafety,
  validateManifest,
  type Capability,
  type Manifest,
  type ScenarioObservation,
} from "./contracts";
import { executeScenario } from "./execution";
import {
  AI_PRICING_CATALOG,
  AI_PRICING_CATALOG_VERSION,
} from "../../server/_core/ai/pricingCatalog";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = path.join(ROOT, "docs/benchmarks/multi-provider/fixtures/manifest.json");
const DEFAULT_REPORT = path.join(ROOT, "docs/benchmarks/multi-provider/results/2026-08-06-executable-harness.json.gz");
const DEFAULT_METADATA = path.join(ROOT, "docs/benchmarks/multi-provider/results/2026-08-06-executable-harness.metadata.json");
const PRICE_CATALOG = path.join(ROOT, "docs/benchmarks/multi-provider/pricing-snapshot.json");
const TRANSCRIPTION_EVIDENCE = path.join(ROOT, "docs/benchmarks/transcription/results/2026-08-04-af087f9b0c64.json");
const RESULT_PREFIX = "docs/benchmarks/multi-provider/results/";

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;
const rate = (yes: number, total: number) => total ? round(yes / total) : 0;

function containsOnlySanitizedEvidence(value: unknown): boolean {
  try {
    scanReportSafety(value);
    return true;
  } catch {
    return false;
  }
}

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

export function summarize(capability: Capability, observations: ScenarioObservation[]) {
  const items = observations.filter(item => item.capability === capability);
  const criticalItems = items.filter(item => item.criticalTotal > 0);
  const criticalPassed = criticalItems.reduce((sum, item) => sum + item.criticalPassed, 0);
  const criticalTotal = criticalItems.reduce((sum, item) => sum + item.criticalTotal, 0);
  const sourceItems = items.filter(item => item.source !== "not-required");
  const deterministic = items.filter(item => item.deterministic);
  const valid = items.filter(item => item.valid);
  const unknownCost = items.some(item => item.calls > 0 && item.estimatedCostUsd === null);
  const totalCost = unknownCost ? null : round(items.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0), 8);
  return {
    capability,
    observations: items.length,
    validOperationRate: rate(valid.length, items.length),
    criticalAccuracy: criticalTotal > 0 ? rate(criticalPassed, criticalTotal) : null,
    falsePositiveRate: rate(items.filter(item => item.falsePositive).length, items.length),
    verifiedSourceRate: sourceItems.length
      ? rate(sourceItems.filter(item => item.source === "verified").length, sourceItems.length)
      : null,
    p50LatencyMs: percentile(items.map(item => item.latencyMs), 0.5),
    p95LatencyMs: percentile(items.map(item => item.latencyMs), 0.95),
    timeoutRate: rate(items.filter(item => item.timedOut).length, items.length),
    retryRate: rate(items.filter(item => item.tags.includes("retry") && item.attempts > 1).length, items.length),
    fallbackRate: rate(items.filter(item => item.fallback !== "none").length, items.length),
    unavailabilityRate: rate(items.filter(item => item.unavailable).length, items.length),
    deterministicNoCallPassRate: deterministic.length
      ? rate(deterministic.filter(item => item.calls === 0).length, deterministic.length)
      : null,
    estimatedTotalCostUsd: totalCost,
    estimatedCostPerValidOperationUsd: totalCost === null || !valid.length ? null : round(totalCost / valid.length, 8),
    safetyRegressions: items.filter(item => item.safetyRegression).length,
    privacyRegressions: items.filter(item => item.privacyRegression).length,
  };
}

const MUTABLE_TRANSCRIPTION_CANDIDATE_ALIAS = "gpt-4o-mini-transcribe";
const IMMUTABLE_TRANSCRIPTION_SNAPSHOT = /^gpt-4o-mini-transcribe-\d{4}-\d{2}-\d{2}$/u;

function exactRuntimeTranscriptionPrice(model: string) {
  const normalized = model.trim().toLowerCase();
  return AI_PRICING_CATALOG.find(entry => {
    const exactModel = entry.provider === "openai"
      && entry.model.trim().toLowerCase() === normalized;
    const hasTranscriptionRate = entry.rates.audio?.unit === "audio_minute"
      || (entry.rates.input?.unit === "million_input_tokens"
        && entry.rates.output?.unit === "million_output_tokens");
    return exactModel && hasTranscriptionRate;
  }) ?? null;
}

function findTranscriptionCandidate(summary: Array<Record<string, number | string | null>> | undefined) {
  return summary?.find(item =>
    typeof item.model === "string"
    && (item.model === MUTABLE_TRANSCRIPTION_CANDIDATE_ALIAS
      || item.model.startsWith(`${MUTABLE_TRANSCRIPTION_CANDIDATE_ALIAS}-`))
  );
}

export async function readTranscriptionEvidence(evidencePath = TRANSCRIPTION_EVIDENCE) {
  try {
    const data = JSON.parse(await readFile(evidencePath, "utf8")) as {
      testedSha?: string;
      priceCatalog?: Record<string, unknown> | null;
      summary?: Array<Record<string, number | string | null>>;
    };
    const baseline = data.summary?.find(item => item.model === "whisper-1");
    const candidate = findTranscriptionCandidate(data.summary);
    if (!baseline || !candidate || !data.testedSha || typeof candidate.model !== "string") {
      throw new Error("incomplete evidence");
    }
    const candidateModel = candidate.model;
    const exactPrice = exactRuntimeTranscriptionPrice(candidateModel);
    const reproducibilityFailures: string[] = [];
    if (candidateModel === MUTABLE_TRANSCRIPTION_CANDIDATE_ALIAS) {
      reproducibilityFailures.push("mutable-candidate-alias");
    } else if (!IMMUTABLE_TRANSCRIPTION_SNAPSHOT.test(candidateModel)) {
      reproducibilityFailures.push("candidate-model-not-immutable-snapshot");
    }
    if (!exactPrice) {
      reproducibilityFailures.push("candidate-price-not-in-runtime-catalog");
    }
    const comparisonCatalogVersion = data.priceCatalog?.version;
    if (typeof comparisonCatalogVersion !== "string") {
      reproducibilityFailures.push("comparison-price-catalog-not-versioned");
    } else if (comparisonCatalogVersion !== AI_PRICING_CATALOG_VERSION) {
      reproducibilityFailures.push("comparison-price-catalog-version-mismatch");
    }

    const wins = candidate.successRate === 1
      && candidate.usefulTextRate === 1
      && Number(candidate.averageCriticalTermRecall) >= Number(baseline.averageCriticalTermRecall)
      && Number(candidate.averageWordErrorRate) <= Number(baseline.averageWordErrorRate)
      && Number(candidate.averageLatencyMs) <= Number(baseline.averageLatencyMs)
      && Number(candidate.estimatedTotalCostUsd) <= Number(baseline.estimatedTotalCostUsd);
    const reproducible = reproducibilityFailures.length === 0;
    return {
      status: "available" as const,
      testedSha: data.testedSha,
      baselineModel: "whisper-1",
      candidateModel,
      decision: wins && reproducible ? "controlled-rollout-candidate" as const : "keep-baseline" as const,
      promotionEligibility: {
        reproducible,
        failures: reproducibilityFailures,
        exactRuntimePricedModel: exactPrice?.model ?? null,
        comparisonPriceCatalog: data.priceCatalog ?? null,
        runtimePriceCatalogVersion: AI_PRICING_CATALOG_VERSION,
      },
      baseline,
      candidate,
    };
  } catch {
    return {
      status: "unavailable" as const,
      testedSha: null,
      baselineModel: "whisper-1",
      candidateModel: MUTABLE_TRANSCRIPTION_CANDIDATE_ALIAS,
      decision: "keep-baseline" as const,
      promotionEligibility: {
        reproducible: false,
        failures: ["transcription-evidence-uV&–ÆÆ–ærâ"À¢%&öÆÆ÷WBæB&öÆÆ&6²–â&VæFW"&WV—&RW‡Æ–6—B÷W&F–öæÂWF†÷&—¦F–öâæB&RG&6¶VB–â—77VR3“c"â"À¢ÒÀ¢&W&öGV7F–öã¢°¢6öÖÖæC¢'çÒ&Væ6†Ö&³¦“¦×VÇF’×&÷f–FW""À¢6Öö¶T6öÖÖæC¢'çÒ6Öö¶S¦—77VRÓ“#r"À¢ÒÀ¢Ó°¢66å&W÷'E6fWG’‡&W÷'B“°¢&WGW&â&W÷'C°§Ð ¦W‡÷'BgVæ7F–öâ'V–ÆE&W÷'DÖWFFF†–çWC¢°¢&W÷'EFƒ¢7G&–æs°¢&W÷'D'—FW3¢'VffW#°¢&W÷'C¢v—FVCÅ&WGW&åG—SÇG—Vöb'V–ÆE&W÷'Cãã°§Ò’°¢6öç7B§6öä'—FW2Ò–çWBç&W÷'EF‚æVæG5v—F‚‚"æw¢"’òwVç¦—7–æ2†–çWBç&W÷'D'—FW2’¢–çWBç&W÷'D'—FW3°¢&WGW&â°¢66†VÖfW'6–öã¢"À¢&W÷'Df÷&ÖC¢–çWBç&W÷'EF‚æVæG5v—F‚‚"æw¢"’ò&Æ–6F–öâö§6öâ¶w¦—"¢&Æ–6F–öâö§6öâ"À¢&W÷'Df–ÆS¢F‚æ&6VæÖR†–çWBç&W÷'EF‚’À¢FW7FVE6†¢–çWBç&W÷'BçFW7FVE6†À¢6÷W&6UG&VU6†#Sc¢–çWBç&W÷'Bç6÷W&6UG&VU6†#SbÀ¢§6öå6†#Sc¢6†#Sb†§6öä'—FW2’À¢&W÷'E6†#Sc¢6†#Sb†–çWBç&W÷'D'—FW2’À¢ö'6W'fF–öä6÷VçC¢–çWBç&W÷'Bæ6÷fW&vRæö'6W'fF–öä6÷VçBÀ¢vÆö&ÄvFW576VC¢–çWBç&W÷'BævÆö&ÄvFW2ç76VBÀ¢&öGV7F–öä6†ævW4Æ–VC¢–çWBç&W÷'Bç&öGV7F–öä6†ævW4Æ–VBÀ¢&öÆÆ÷WE7FGW3¢–çWBç&W÷'Bç&öÆÆ÷WDFV6—6–öâç7FGW2À¢÷W&F–öæÄ—77VS¢“c"À¢Ó°§Ð ¦W‡÷'B7–æ2gVæ7F–öâ&VDÖæ–fW7B†Öæ–fW7EF‚ÒDTdTÅEôÔä”dU5B“¢&öÖ—6SÄÖæ–fW7Câ°¢6öç7B–æFW‚Ò¥4ôâç'6R†v—B&VDf–ÆR†Öæ–fW7EF‚Â'WFc‚"’’2öÖ—CÄÖæ–fW7BÂ'66Væ&–÷2#âb°¢66Væ&–÷3ó¢Öæ–fW7E²'66Væ&–÷2%Ó°¢66Væ&–ôf–ÆW3ó¢7G&–æuµÓ°¢Ó°¢–b†–æFW‚ç66Væ&–÷2’&WGW&â–æFW‚2Öæ–fW7C°¢6öç7BF—&V7F÷'’ÒF‚æF—&æÖR†Öæ–fW7EF‚“°¢6öç7B66Væ&–÷2Ò†v—B&öÖ—6RæÆÂ‚†–æFW‚ç66Væ&–ôf–ÆW2óòµÒ’æÖ†7–æ2f–ÆRÓâ€¢¥4ôâç'6R†v—B&VDf–ÆR‡F‚æ¦ö–â†F—&V7F÷'’Âf–ÆR’Â'WFc‚"’’2Öæ–fW7E²'66Væ&–÷2%Ð¢’’’’’æfÆB‚“°¢6öç7B²66Væ&–ôf–ÆW3¢÷66Væ&–ôf–ÆW2ÂââæÖWFFFÒÒ–æFWƒ°¢&WGW&â²ââæÖWFFFÂ66Væ&–÷2Ò2Öæ–fW7C°§Ð ¦W‡÷'B7–æ2gVæ7F–öâfW&–g”6öÖÖ—GFVE&W÷'B€¢&W÷'EF‚ÒDTdTÅEõ$Uõ%BÀ¢Öæ–fW7EF‚ÒDTdTÅEôÔä”dU5BÀ¢ÖWFFFF‚ÒDTdTÅEôÔUDDDÀ¢“¢&öÖ—6SÇfö–Câ°¢6öç7BVæ6öFVBÒv—B&VDf–ÆR‡&W÷'EF‚“°¢6öç7B&W÷'EFW‡BÒ&W÷'EF‚æVæG5v—F‚‚"æw¢"’òwVç¦—7–æ2†Væ6öFVB’çFõ7G&–ær‚'WFc‚"’¢Væ6öFVBçFõ7G&–ær‚'WFc‚"“°¢6öç7B6öÖÖ—GFVBÒ¥4ôâç'6R‡&W÷'EFW‡B’2v—FVCÅ&WGW&åG—SÇG—Vöb'V–ÆE&W÷'Cãã°¢66å&W÷'E6fWG’†6öÖÖ—GFVB“°¢6öç7B7GVÄ†6‚Òv—B†6„W†V7WF&ÆU6÷W&6UG&VR‚“°¢6öç7BÖæ–fW7BÒv—B&VDÖæ–fW7B†Öæ–fW7EF‚“°¢6öç7BfW&–f–VD†VBÒ&ö6W72æVçbådU$”d”4D”ôåô„TEõ4„óòv—B…²'&Wb×'6R"Â$„TB%Ò“°¢76W'BæÖF6‚†6öÖÖ—GFVBçFW7FVE6†óò""Âõå³Ó–Öe×³CÒB÷RÂ&6öÖÖ—GFVB&W÷'BÆ6·2FW7FVB6öÖÖ—B4„"“°¢W†V4f–ÆU7–æ2‚&v—B"Â²&ÖW&vRÖ&6R"Â"ÒÖ—2Öæ6W7F÷""Â6öÖÖ—GFVBçFW7FVE6†ÂfW&–f–VD†VEÒÂ²7vC¢$ôõBÒ“°¢6öç7BFVÇFÒv—B…²&F–fb"Â"ÒÖæÖRÖöæÇ’"ÂG¶6öÖÖ—GFVBçFW7FVE6†ÒââG·fW&–f–VD†VGÖÒ’ç7Æ—B‚%Æâ"’æf–ÇFW"„&ööÆVâ“°¢76W'BæWVÂ€¢FVÇFæWfW'’†f–ÆRÓâf–ÆRç7F'G5v—F‚…$U5TÅEõ$Td•‚’’À¢G'VRÀ¢6öÖÖ—GFVB&W÷'BFW7FVBF–ffW&VçBW†V7WF&ÆRG&VS¢G¶FVÇFæ¦ö–â‚"Â"—ÖÀ¢“°¢76W'BæWVÂ†6öÖÖ—GFVBç6÷W&6UG&VU6†#SbÂ7GVÄ†6‚Â&6öÖÖ—GFVB&W÷'B—27FÆRf÷"F†RW†V7WF&ÆR6÷W&6RG&VR"“°¢76W'BæWVÂ†6öÖÖ—GFVBævÆö&ÄvFW3òç76VBÂG'VR“°¢76W'BæWVÂ†6öÖÖ—GFVBæ6÷fW&vSòæö'6W'fF–öä6÷VçBÂÖæ–fW7Bç66Væ&–÷2æÆVæwF‚“°¢76W'BæWVÂ†6öÖÖ—GFVBç'V'&–5fW'6–öâÂÖæ–fW7Bç'V'&–5fW'6–öâ“°¢6öç7B&VvVæW&FVBÒv—B'V–ÆE&W÷'B‡°¢Öæ–fW7BÀ¢vVæW&FVDC¢6öÖÖ—GFVBævVæW&FVDBÀ¢FW7FVE6†¢6öÖÖ—GFVBçFW7FVE6†À¢6÷W&6UG&VU6†#Sc¢7GVÄ†6‚À¢Ò“°¢76W'BæFVWWVÂ†6öÖÖ—GFVBÂ&VvVæW&FVBÂ&6öÖÖ—GFVB&W÷'BF–ffW'2g&öÒFWFW&Ö–æ—7F–2&VvVæW&F–öâ"“° ¢6öç7BÖWFFFÒ¥4ôâç'6R†v—B&VDf–ÆR†ÖWFFFF‚Â'WFc‚"’’2&WGW&åG—SÇG—Vöb'V–ÆE&W÷'DÖWFFFã°¢76W'BæFVWWVÂ€¢ÖWFFFÀ¢'V–ÆE&W÷'DÖWFFF‡²&W÷'EF‚Â&W÷'D'—FW3¢Væ6öFVBÂ&W÷'C¢6öÖÖ—GFVBÒ’À¢&6öÖÖ—GFVB&W÷'BÖWFFFFöW2æ÷B&–æBF†RW†7B&W÷'B'—FW2æB–FVçF—G’"À¢“°§Ð ¦W‡÷'B7–æ2gVæ7F–öâ'Vå6VÆeFW7B‚“¢&öÖ—6SÇfö–Câ°¢6öç7BÖæ–fW7BÒv—B&VDÖæ–fW7B‚“°¢6öç7B&W÷'BÒv—B'V–ÆE&W÷'B‡°¢Öæ–fW7BÀ¢FW7FVE6†¢'6VÆb×FW7B"À¢6÷W&6UG&VU6†#Sc¢'6VÆb×FW7B×G&VR"À¢vVæW&FVDC¢###bÓ‚ÓeC££ã¢"À¢Ò“°¢76W'BæWVÂ‡&W÷'BævÆö&ÄvFW2ç76VBÂG'VR“°¢76W'BæWVÂ‡&W÷'Bç&öGV7F–öä6†ævW4Æ–VBÂfÇ6R“°¢76W'BæWVÂ‡&W÷'Bæ6÷fW&vRæö'6W'fF–öä6÷VçBÂÖæ–fW7Bç66Væ&–÷2æÆVæwF‚“°¢76W'BæWVÂ‡&W÷'Bç&öÖ÷F–öäFV6—6–öç2æWfW'’†—FVÒÓâ—FVÒæfÆÆ&6´Væ&ÆVB’ÂG'VR“°¢76W'BæWVÂ‡&W÷'Bç&öÖ÷F–öäFV6—6–öç2æWfW'’†—FVÒÓâ—FVÒæ7&÷75&÷f–FW$fÆÆ&6´Væ&ÆVB’ÂG'VR“°¢76W'BæWVÂ‡&W÷'Bæö'6W'fF–öç2ç6öÖR†—FVÒÓâ—FVÒæfÆÆ&6²ÓÓÒ'6ÖR×&÷f–FW""’ÂG'VR“°¢76W'BæWVÂ‡&W÷'Bæö'6W'fF–öç2ç6öÖR†—FVÒÓâ—FVÒæfÆÆ&6²ÓÓÒ&7&÷72×&÷f–FW""’ÂG'VR“°¢76W'BæWVÂ‡&W÷'Bæö'6W'fF–öç2æf–ÇFW"†—FVÒÓâ—FVÒæFWFW&Ö–æ—7F–2’æWfW'’†—FVÒÓâ—FVÒæ6ÆÇ2ÓÓÒ’ÂG'VR“°§Ð