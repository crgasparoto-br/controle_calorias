import type { WhatsappDriftSnapshot, WhatsappDriftVersionContext } from "./driftDetection";
import type { WhatsappPromotionPlan } from "./gradualPromotion";
import type { WhatsappIntentName } from "./intentSchema";
import type { WhatsappMessageHistoryEntry, WhatsappMessageHistoryInputType, WhatsappMessageItemObservation } from "./messageHistory";
import {
  listPersistedWhatsappLearningArtifacts,
  persistWhatsappLearningArtifact,
} from "./learningArtifactPersistence";

export const WHATSAPP_QUALITY_METRICS_VERSION = "whatsapp-quality-metrics/v1";

export type WhatsappQualityMetricsAccess = "protected_internal_query";
export type WhatsappFeedbackSignal = "positive" | "negative" | "correction";
export type WhatsappQualityAutonomyOutcome = "automatic" | "confirmation" | "review" | "blocked";

export type WhatsappQualityFeedbackEvent = {
  id: string;
  historyId: number;
  createdAt: string;
  intent: WhatsappIntentName | "unknown";
  signal: WhatsappFeedbackSignal;
};

export type WhatsappNutritionEstimateComparison = {
  id: string;
  historyId: number;
  createdAt: string;
  caloriesEstimated: number;
  caloriesConfirmed: number;
  category?: string | null;
  brand?: string | null;
  preparation?: string | null;
};

export type WhatsappAutonomyMetricEvent = {
  id: string;
  historyId: number;
  createdAt: string;
  intent: WhatsappIntentName | "unknown";
  outcome: WhatsappQualityAutonomyOutcome;
  sensitive: boolean;
};

export type WhatsappQualityMetricsSegment = {
  key: string;
  intent: WhatsappIntentName | "unknown";
  inputType: WhatsappMessageHistoryInputType;
  version: WhatsappDriftVersionContext;
  period: { from: string; to: string };
  sampleSize: number;
  itemCount: number;
  highConfidenceRate: number;
  lowConfidenceRate: number;
  ambiguityRate: number;
  fallbackSafeRate: number;
  fallbackRate: number;
  quantityRecognitionRate: number;
  variantRecognitionRate: number;
  estimatedNutritionRate: number;
  ambiguityRateByItem: number;
  laterCorrectionRateByItem: number;
  ocrEvidenceRate: number;
  transcriptionEvidenceRate: number;
  laterCorrectionRate: number;
  brandRecognitionRate: number;
  specificNutritionSourceRate: number;
  traceabilityCoverageRate: number;
  autonomy: Record<WhatsappQualityAutonomyOutcome, number>;
  feedback: Record<WhatsappFeedbackSignal, number>;
};

export type WhatsappQualityMetricsReport = {
  id: number;
  createdAt: string;
  access: WhatsappQualityMetricsAccess;
  period: { from: string; to: string } | null;
  totals: {
    messages: number;
    items: number;
    highConfidenceRate: number;
    lowConfidenceRate: number;
    ambiguityRate: number;
    fallbackSafeRate: number;
    fallbackRate: number;
    quantityRecognitionRate: number;
    variantRecognitionRate: number;
    fallbackSafetyDenominator: number;
    fallbackSafeCount: number;
    laterCorrectionRate: number;
    feedbackPositive: number;
    feedbackNegative: number;
    feedbackCorrections: number;
    brandRecognized: number;
    specificNutritionSources: number;
    estimatedNutritionSources: number;
    ocrEvidenceItems: number;
    transcriptionEvidenceItems: number;
    averageNutritionCalorieError: number | null;
    traceabilityCoverageRate: number;
    actionsByAutonomy: Record<WhatsappQualityAutonomyOutcome, number>;
    sensitiveBlockedOrReviewed: number;
    promotionCandidates: Record<WhatsappPromotionPlan["stage"], number>;
  };
  segments: WhatsappQualityMetricsSegment[];
  nutritionDivergence: Array<{ key: string; count: number; averageCalorieError: number }>;
  driftSnapshots: WhatsappDriftSnapshot[];
  policyVersion: typeof WHATSAPP_QUALITY_METRICS_VERSION;
  integrations: typeof WHATSAPP_QUALITY_METRICS_POLICY.integrations;
};

type MetricsInput = {
  entries: WhatsappMessageHistoryEntry[];
  feedback?: WhatsappQualityFeedbackEvent[];
  autonomy?: WhatsappAutonomyMetricEvent[];
  nutritionComparisons?: WhatsappNutritionEstimateComparison[];
  promotionPlans?: Pick<WhatsappPromotionPlan, "stage">[];
  createdAt?: Date;
};

const reports: WhatsappQualityMetricsReport[] = [];
let nextReportId = 1;

export const WHATSAPP_QUALITY_METRICS_POLICY = {
  access: "protected_internal_query" satisfies WhatsappQualityMetricsAccess,
  highConfidenceThreshold: 0.85,
  lowConfidenceThreshold: 0.5,
  requiredTraceability: ["intent", "inputType", "confidence", "strategy", "versions", "nutritionSource", "status", "persisted", "correctionLink"],
  driftSnapshotMetrics: ["low_confidence_rate", "fallback_rate", "ambiguity_rate", "later_correction_rate", "brand_recognition_rate", "quantity_recognition_rate", "intent_accuracy", "persistence_error_rate"],
  integrations: {
    retentionPrivacy: "#432",
    feedback: "#430",
    promotion: "#431",
    drift: "#434",
    nutritionComparison: "#435",
    autonomy: "#436",
  },
  version: WHATSAPP_QUALITY_METRICS_VERSION,
} as const;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function clampRate(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function round(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function rate(count: number, total: number) {
  return total > 0 ? clampRate(count / total) : 0;
}

function periodFrom(entries: Array<{ createdAt: string }>) {
  if (entries.length === 0) return null;
  return {
    from: entries.map(entry => entry.createdAt).sort()[0],
    to: entries.map(entry => entry.createdAt).sort().at(-1) ?? entries[0].createdAt,
  };
}

function versionFrom(entry: WhatsappMessageHistoryEntry): WhatsappDriftVersionContext {
  return {
    promptVersion: entry.versions.promptVersion ?? "unknown-prompt",
    schemaVersion: entry.versions.schemaVersion ?? "unknown-schema",
    modelName: entry.versions.modelName ?? "unknown-model",
    ruleVersion: entry.versions.ruleVersion ?? "unknown-rule",
    nutritionSourceVersion: entry.nutritionSource?.sourceType ?? undefined,
    classifierVersion: entry.versions.parserVersion ?? undefined,
  };
}

function versionKey(version: WhatsappDriftVersionContext) {
  return [version.promptVersion, version.schemaVersion, version.modelName, version.ruleVersion, version.nutritionSourceVersion ?? "", version.classifierVersion ?? ""].join("|");
}

function segmentKey(entry: WhatsappMessageHistoryEntry) {
  return `${entry.intent}|${entry.inputType}|${versionKey(versionFrom(entry))}`;
}

function hasTraceability(entry: WhatsappMessageHistoryEntry) {
  return Boolean(
    entry.intent
      && entry.inputType
      && entry.status
      && entry.persisted
      && entry.versions.schemaVersion
      && (entry.strategy || entry.versions.parserVersion || entry.versions.modelName)
      && (entry.confidence !== null || entry.status === "blocked" || entry.status === "error"),
  );
}

function isFallback(entry: WhatsappMessageHistoryEntry) {
  return entry.reply.kind === "fallback" || entry.statusReason === "fallback" || entry.action.includes("fallback");
}

function observationsFor(entry: WhatsappMessageHistoryEntry): WhatsappMessageItemObservation[] {
  if (entry.itemObservations?.length) return entry.itemObservations;
  return entry.entities.foods.map((foodName, itemIndex) => ({
    itemIndex,
    foodName,
    brand: entry.entities.brands[itemIndex] ?? null,
    variant: entry.entities.variants?.[itemIndex] ?? null,
    quantity: entry.entities.quantity?.value ?? null,
    unit: entry.entities.quantity?.unit ?? null,
    portion: null,
    nutritionSource: entry.nutritionSource?.sourceType ?? null,
    nutritionEstimated: entry.nutritionSource?.estimated ?? null,
    confidence: entry.confidence,
    ambiguous: isAmbiguous(entry),
    corrected: entry.correctionOfHistoryId !== null,
    fallback: isFallback(entry),
    fallbackSafe: null,
    brandEvidence: entry.inputType === "audio_transcript" ? "transcription" : entry.inputType === "image_caption" ? "ocr" : entry.inputType === "multimodal" ? "vision" : "text",
    variantEvidence: entry.inputType === "audio_transcript" ? "transcription" : entry.inputType === "image_caption" ? "ocr" : entry.inputType === "multimodal" ? "vision" : "text",
    quantityEvidence: entry.inputType === "audio_transcript" ? "transcription" : entry.inputType === "image_caption" ? "ocr" : entry.inputType === "multimodal" ? "vision" : "text",
  }));
}

function observationsForEntries(entries: WhatsappMessageHistoryEntry[]) {
  return entries.flatMap(observationsFor);
}

function itemFallbackSummary(observations: WhatsappMessageItemObservation[], legacyTotal: number) {
  const fallbackItems = observations.filter(item => item.fallback);
  const classified = fallbackItems.filter(item => item.fallbackSafe !== null);
  const safeCount = classified.filter(item => item.fallbackSafe === true).length;
  return {
    fallbackCount: fallbackItems.length,
    safeCount,
    denominator: classified.length,
    hasExplicitClassification: classified.length > 0,
    compatibilityRate: rate(fallbackItems.length, legacyTotal),
  };
}

function itemRate(observations: WhatsappMessageItemObservation[], predicate: (item: WhatsappMessageItemObservation) => boolean) {
  return rate(observations.filter(predicate).length, observations.length);
}

function isAmbiguous(entry: WhatsappMessageHistoryEntry) {
  return entry.status === "ambiguous" || entry.reply.kind === "clarification";
}

function isLowConfidence(entry: WhatsappMessageHistoryEntry) {
  return entry.status === "low_confidence" || (entry.confidence !== null && entry.confidence < WHATSAPP_QUALITY_METRICS_POLICY.lowConfidenceThreshold);
}

function isHighConfidence(entry: WhatsappMessageHistoryEntry) {
  return entry.confidence !== null && entry.confidence >= WHATSAPP_QUALITY_METRICS_POLICY.highConfidenceThreshold;
}

function emptyAutonomy(): Record<WhatsappQualityAutonomyOutcome, number> {
  return { automatic: 0, confirmation: 0, review: 0, blocked: 0 };
}

function emptyFeedback(): Record<WhatsappFeedbackSignal, number> {
  return { positive: 0, negative: 0, correction: 0 };
}

function promotionCounts(plans: Pick<WhatsappPromotionPlan, "stage">[] = []): Record<WhatsappPromotionPlan["stage"], number> {
  const counts: Record<WhatsappPromotionPlan["stage"], number> = { draft: 0, shadow: 0, canary: 0, broad: 0, rejected: 0, rolled_back: 0 };
  for (const plan of plans) counts[plan.stage] += 1;
  return counts;
}

function averageCalorieError(comparisons: WhatsappNutritionEstimateComparison[]) {
  if (comparisons.length === 0) return null;
  return round(comparisons.reduce((sum, item) => sum + Math.abs(item.caloriesConfirmed - item.caloriesEstimated), 0) / comparisons.length);
}

function nutritionDivergence(comparisons: WhatsappNutritionEstimateComparison[]) {
  const grouped = new Map<string, { count: number; totalError: number }>();
  for (const item of comparisons) {
    const key = [item.category ?? "sem_categoria", item.brand ?? "sem_marca", item.preparation ?? "sem_preparo"].join("|");
    const current = grouped.get(key) ?? { count: 0, totalError: 0 };
    current.count += 1;
    current.totalError += Math.abs(item.caloriesConfirmed - item.caloriesEstimated);
    grouped.set(key, current);
  }
  return [...grouped.entries()]
    .map(([key, value]) => ({ key, count: value.count, averageCalorieError: round(value.totalError / value.count) }))
    .sort((a, b) => b.averageCalorieError - a.averageCalorieError);
}

function segmentFor(entries: WhatsappMessageHistoryEntry[], feedback: WhatsappQualityFeedbackEvent[], autonomy: WhatsappAutonomyMetricEvent[]): WhatsappQualityMetricsSegment {
  const first = entries[0];
  const observations = observationsForEntries(entries);
  const fallback = itemFallbackSummary(observations, entries.length);
  const correctionCount = entries.filter(entry => entry.correctionOfHistoryId !== null).length + feedback.filter(item => item.signal === "correction").length;
  const segmentAutonomy = emptyAutonomy();
  for (const event of autonomy) segmentAutonomy[event.outcome] += 1;
  const segmentFeedback = emptyFeedback();
  for (const event of feedback) segmentFeedback[event.signal] += 1;
  const version = versionFrom(first);
  const sampleSize = entries.length;
  return {
    key: segmentKey(first),
    intent: first.intent,
    inputType: first.inputType,
    version,
    period: periodFrom(entries) ?? { from: first.createdAt, to: first.createdAt },
    sampleSize,
    itemCount: observations.length,
    highConfidenceRate: rate(entries.filter(isHighConfidence).length, sampleSize),
    lowConfidenceRate: rate(entries.filter(isLowConfidence).length, sampleSize),
    ambiguityRate: rate(entries.filter(isAmbiguous).length, sampleSize),
    fallbackSafeRate: fallback.hasExplicitClassification
      ? rate(fallback.safeCount, fallback.denominator)
      : fallback.compatibilityRate,
    fallbackRate: rate(fallback.fallbackCount, observations.length),
    quantityRecognitionRate: itemRate(observations, item => item.quantity !== null && item.quantityEvidence !== "unknown"),
    variantRecognitionRate: itemRate(observations, item => Boolean(item.variant)),
    ambiguityRateByItem: itemRate(observations, item => item.ambiguous),
    laterCorrectionRateByItem: itemRate(observations, item => item.corrected),
    ocrEvidenceRate: itemRate(observations, item => item.brandEvidence === "ocr" || item.variantEvidence === "ocr" || item.quantityEvidence === "ocr"),
    transcriptionEvidenceRate: itemRate(observations, item => item.brandEvidence === "transcription" || item.variantEvidence === "transcription" || item.quantityEvidence === "transcription"),
    laterCorrectionRate: rate(correctionCount, sampleSize),
    brandRecognitionRate: itemRate(observations, item => Boolean(item.brand)),
    specificNutritionSourceRate: itemRate(observations, item => Boolean(item.nutritionSource && item.nutritionEstimated === false)),
    estimatedNutritionRate: itemRate(observations, item => item.nutritionEstimated === true),
    traceabilityCoverageRate: rate(entries.filter(hasTraceability).length, sampleSize),
    autonomy: segmentAutonomy,
    feedback: segmentFeedback,
  };
}

function segmentsFrom(input: MetricsInput) {
  const grouped = new Map<string, WhatsappMessageHistoryEntry[]>();
  for (const entry of input.entries) {
    const key = segmentKey(entry);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return [...grouped.values()].map(entries => {
    const ids = new Set(entries.map(entry => entry.id));
    return segmentFor(
      entries,
      (input.feedback ?? []).filter(item => ids.has(item.historyId)),
      (input.autonomy ?? []).filter(item => ids.has(item.historyId)),
    );
  });
}

function driftSnapshotFrom(segment: WhatsappQualityMetricsSegment): WhatsappDriftSnapshot {
  return {
    id: `metrics-${segment.key}`,
    period: segment.period,
    sampleSize: segment.sampleSize,
    intent: segment.intent,
    inputType: segment.inputType,
    conversationMode: segment.inputType === "multi_turn" ? "multi_turn" : "single_turn",
    versions: segment.version,
    metrics: {
      low_confidence_rate: segment.lowConfidenceRate,
      fallback_rate: segment.fallbackRate,
      ambiguity_rate: segment.ambiguityRate,
      later_correction_rate: segment.laterCorrectionRate,
      brand_recognition_rate: segment.brandRecognitionRate,
      quantity_recognition_rate: segment.quantityRecognitionRate,
      intent_accuracy: 1 - segment.fallbackRate,
      persistence_error_rate: rate(segment.autonomy.blocked + segment.autonomy.review, segment.sampleSize),
    },
  };
}

export function buildWhatsappQualityMetricsReport(input: MetricsInput): WhatsappQualityMetricsReport {
  const createdAt = toIso(input.createdAt);
  const entries = input.entries;
  const feedback = input.feedback ?? [];
  const autonomy = input.autonomy ?? [];
  const nutritionComparisons = input.nutritionComparisons ?? [];
  const observations = observationsForEntries(entries);
  const fallback = itemFallbackSummary(observations, entries.length);
  const explicitFallbackSafeRate = fallback.denominator > 0 ? rate(fallback.safeCount, fallback.denominator) : null;
  const actionsByAutonomy = emptyAutonomy();
  for (const event of autonomy) actionsByAutonomy[event.outcome] += 1;
  const segments = segmentsFrom(input).sort((a, b) => a.key.localeCompare(b.key));
  const report: WhatsappQualityMetricsReport = {
    id: nextReportId,
    createdAt,
    access: WHATSAPP_QUALITY_METRICS_POLICY.access,
    period: periodFrom(entries),
    totals: {
      messages: entries.length,
      items: observations.length,
      highConfidenceRate: rate(entries.filter(isHighConfidence).length, entries.length),
      lowConfidenceRate: rate(entries.filter(isLowConfidence).length, entries.length),
      ambiguityRate: rate(entries.filter(isAmbiguous).length, entries.length),
      fallbackSafeRate: explicitFallbackSafeRate ?? rate(entries.filter(isFallback).length, entries.length),
      fallbackRate: rate(fallback.fallbackCount, observations.length),
      quantityRecognitionRate: itemRate(observations, item => item.quantity !== null && item.quantityEvidence !== "unknown"),
      variantRecognitionRate: itemRate(observations, item => Boolean(item.variant)),
      fallbackSafetyDenominator: fallback.denominator,
      fallbackSafeCount: fallback.safeCount,
      laterCorrectionRate: rate(entries.filter(entry => entry.correctionOfHistoryId !== null).length + feedback.filter(item => item.signal === "correction").length, entries.length),
      feedbackPositive: feedback.filter(item => item.signal === "positive").length,
      feedbackNegative: feedback.filter(item => item.signal === "negative").length,
      feedbackCorrections: feedback.filter(item => item.signal === "correction").length,
      brandRecognized: observations.filter(item => Boolean(item.brand)).length,
      specificNutritionSources: observations.filter(item => Boolean(item.nutritionSource && item.nutritionEstimated === false)).length,
      estimatedNutritionSources: observations.filter(item => item.nutritionEstimated === true).length,
      ocrEvidenceItems: observations.filter(item => item.brandEvidence === "ocr" || item.variantEvidence === "ocr" || item.quantityEvidence === "ocr").length,
      transcriptionEvidenceItems: observations.filter(item => item.brandEvidence === "transcription" || item.variantEvidence === "transcription" || item.quantityEvidence === "transcription").length,
      averageNutritionCalorieError: averageCalorieError(nutritionComparisons),
      traceabilityCoverageRate: rate(entries.filter(hasTraceability).length, entries.length),
      actionsByAutonomy,
      sensitiveBlockedOrReviewed: autonomy.filter(item => item.sensitive && (item.outcome === "blocked" || item.outcome === "review")).length,
      promotionCandidates: promotionCounts(input.promotionPlans),
    },
    segments,
    nutritionDivergence: nutritionDivergence(nutritionComparisons),
    driftSnapshots: segments.map(driftSnapshotFrom),
    policyVersion: WHATSAPP_QUALITY_METRICS_VERSION,
    integrations: WHATSAPP_QUALITY_METRICS_POLICY.integrations,
  };
  nextReportId += 1;
  reports.push(report);
  void persistWhatsappQualityMetricsReport(report);
  return report;
}

export function listWhatsappQualityMetricsReports(filter: Partial<Pick<WhatsappQualityMetricsReport, "access">> = {}) {
  return reports.filter(report => {
    if (filter.access && report.access !== filter.access) return false;
    return true;
  });
}

export async function persistWhatsappQualityMetricsReport(report: WhatsappQualityMetricsReport) {
  return persistWhatsappLearningArtifact({
    scope: "global",
    userId: null,
    kind: "quality_metrics_report",
    key: `report:${report.id}`,
    value: report,
    createdAt: new Date(report.createdAt),
  });
}

export async function buildWhatsappQualityMetricsReportDurably(input: MetricsInput) {
  const report = buildWhatsappQualityMetricsReport(input);
  const persisted = await persistWhatsappQualityMetricsReport(report);
  return { report, persisted: Boolean(persisted) };
}

export async function loadPersistedWhatsappQualityMetricsReports() {
  const artifacts = await listPersistedWhatsappLearningArtifacts<WhatsappQualityMetricsReport>({
    scope: "global",
    kind: "quality_metrics_report",
  });
  if (artifacts === null) return null;
  return artifacts.map(artifact => artifact.value).filter(report => report && typeof report.id === "number");
}

export function __resetWhatsappQualityMetricsForTests() {
  reports.length = 0;
  nextReportId = 1;
}
