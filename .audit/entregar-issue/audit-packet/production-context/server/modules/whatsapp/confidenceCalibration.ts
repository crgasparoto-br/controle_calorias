import type { WhatsappIntentName } from "./intentSchema";
import type { WhatsappMessageHistoryInputType } from "./messageHistory";

export const WHATSAPP_CONFIDENCE_CALIBRATION_VERSION = "whatsapp-confidence-calibration/v1";

export type WhatsappConfidenceKind = "intent" | "entity" | "nutrition_source" | "memory" | "final_action";
export type WhatsappActionRisk = "simple_food_record" | "correction" | "removal" | "goal_change" | "professional_suggestion" | "medical_sensitive" | "persistent_tool" | "rule_promotion";
export type WhatsappCalibratedDecision = "allow" | "clarify" | "review" | "block";
export type WhatsappConfidenceBand = "0.00-0.49" | "0.50-0.69" | "0.70-0.84" | "0.85-0.94" | "0.95-1.00";

export type WhatsappCalibrationVersionContext = {
  promptVersion: string;
  schemaVersion: string;
  modelName: string;
  ruleVersion: string;
  calibratorVersion: string;
  thresholdPolicyVersion: string;
};

export type WhatsappCalibrationObservation = {
  id: string;
  createdAt: string;
  intent: WhatsappIntentName | "unknown";
  inputType: WhatsappMessageHistoryInputType;
  actionRisk: WhatsappActionRisk;
  confidenceKind: WhatsappConfidenceKind;
  rawConfidence: number;
  wasCorrect: boolean;
  falsePositive: boolean;
  falseNegative: boolean;
  laterCorrection: boolean;
  unnecessaryClarification: boolean;
  versions: WhatsappCalibrationVersionContext;
};

export type WhatsappCalibrationSegmentMetrics = {
  total: number;
  correct: number;
  falsePositive: number;
  falseNegative: number;
  laterCorrections: number;
  unnecessaryClarifications: number;
  observedAccuracy: number;
  byBand: Record<WhatsappConfidenceBand, { total: number; correct: number; observedAccuracy: number }>;
};

export type WhatsappCalibrationResult = {
  rawConfidence: number;
  calibratedConfidence: number;
  threshold: number;
  decision: WhatsappCalibratedDecision;
  confidenceKind: WhatsappConfidenceKind;
  actionRisk: WhatsappActionRisk;
  sampleSize: number;
  lowSample: boolean;
  recalibrationRequired: boolean;
  conservativeFallback: boolean;
  reason: string;
  versions: WhatsappCalibrationVersionContext;
  policyVersion: typeof WHATSAPP_CONFIDENCE_CALIBRATION_VERSION;
};

type CalibrateInput = {
  rawConfidence: number;
  confidenceKind: WhatsappConfidenceKind;
  intent: WhatsappIntentName | "unknown";
  inputType: WhatsappMessageHistoryInputType;
  actionRisk: WhatsappActionRisk;
  observedAccuracy?: number | null;
  sampleSize?: number;
  versions: WhatsappCalibrationVersionContext;
  activeVersions?: Partial<WhatsappCalibrationVersionContext>;
};

export const WHATSAPP_CONFIDENCE_THRESHOLDS: Record<WhatsappActionRisk, number> = {
  simple_food_record: 0.74,
  correction: 0.88,
  removal: 0.9,
  goal_change: 0.95,
  professional_suggestion: 0.94,
  medical_sensitive: 0.98,
  persistent_tool: 0.85,
  rule_promotion: 0.95,
};

export const WHATSAPP_CONFIDENCE_CALIBRATION_POLICY = {
  rawConfidence: "Valor retornado pelo modelo, classificador ou regra antes de ajuste por erro observado.",
  calibratedConfidence: "Confianca ajustada por acuracia historica do segmento de intencao, modalidade, risco e versao.",
  thresholds: WHATSAPP_CONFIDENCE_THRESHOLDS,
  minSampleSize: 20,
  lowSampleFallback: "review",
  integrations: {
    backendValidation: "#412",
    metrics: "#417",
    drift: "#431",
    knowledgeValidity: "#434",
    autonomy: "#436",
    negativeEvaluation: "#441",
  },
  version: WHATSAPP_CONFIDENCE_CALIBRATION_VERSION,
} as const;

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function bandFor(value: number): WhatsappConfidenceBand {
  const confidence = clamp(value);
  if (confidence < 0.5) return "0.00-0.49";
  if (confidence < 0.7) return "0.50-0.69";
  if (confidence < 0.85) return "0.70-0.84";
  if (confidence < 0.95) return "0.85-0.94";
  return "0.95-1.00";
}

function emptyBands(): WhatsappCalibrationSegmentMetrics["byBand"] {
  return {
    "0.00-0.49": { total: 0, correct: 0, observedAccuracy: 0 },
    "0.50-0.69": { total: 0, correct: 0, observedAccuracy: 0 },
    "0.70-0.84": { total: 0, correct: 0, observedAccuracy: 0 },
    "0.85-0.94": { total: 0, correct: 0, observedAccuracy: 0 },
    "0.95-1.00": { total: 0, correct: 0, observedAccuracy: 0 },
  };
}

function versionChanged(input: CalibrateInput) {
  const active = input.activeVersions;
  if (!active) return false;
  return Object.entries(active).some(([key, value]) => value !== undefined && input.versions[key as keyof WhatsappCalibrationVersionContext] !== value);
}

function decisionFrom(input: { calibrated: number; threshold: number; lowSample: boolean; recalibrationRequired: boolean; actionRisk: WhatsappActionRisk }) {
  if (input.actionRisk === "medical_sensitive" && input.calibrated < input.threshold) return "block";
  if (input.lowSample || input.recalibrationRequired) return "review";
  if (input.calibrated >= input.threshold) return "allow";
  return input.calibrated >= Math.max(0.5, input.threshold - 0.2) ? "clarify" : "review";
}

export function measureWhatsappCalibrationAccuracy(observations: WhatsappCalibrationObservation[]): WhatsappCalibrationSegmentMetrics {
  const byBand = emptyBands();
  const metrics: WhatsappCalibrationSegmentMetrics = {
    total: observations.length,
    correct: 0,
    falsePositive: 0,
    falseNegative: 0,
    laterCorrections: 0,
    unnecessaryClarifications: 0,
    observedAccuracy: 0,
    byBand,
  };

  for (const observation of observations) {
    metrics.correct += observation.wasCorrect ? 1 : 0;
    metrics.falsePositive += observation.falsePositive ? 1 : 0;
    metrics.falseNegative += observation.falseNegative ? 1 : 0;
    metrics.laterCorrections += observation.laterCorrection ? 1 : 0;
    metrics.unnecessaryClarifications += observation.unnecessaryClarification ? 1 : 0;
    const band = byBand[bandFor(observation.rawConfidence)];
    band.total += 1;
    band.correct += observation.wasCorrect ? 1 : 0;
  }

  metrics.observedAccuracy = metrics.total ? clamp(metrics.correct / metrics.total) : 0;
  for (const band of Object.values(byBand)) {
    band.observedAccuracy = band.total ? clamp(band.correct / band.total) : 0;
  }
  return metrics;
}

export function calibrateWhatsappConfidence(input: CalibrateInput): WhatsappCalibrationResult {
  const rawConfidence = clamp(input.rawConfidence);
  const threshold = WHATSAPP_CONFIDENCE_THRESHOLDS[input.actionRisk];
  const sampleSize = input.sampleSize ?? 0;
  const lowSample = sampleSize < WHATSAPP_CONFIDENCE_CALIBRATION_POLICY.minSampleSize;
  const recalibrationRequired = versionChanged(input);
  const observedAccuracy = input.observedAccuracy === null || input.observedAccuracy === undefined ? rawConfidence : clamp(input.observedAccuracy);
  const reliability = lowSample ? Math.min(observedAccuracy, 0.62) : observedAccuracy;
  const calibratedConfidence = clamp(rawConfidence * (0.5 + reliability / 2));
  const conservativeFallback = lowSample || recalibrationRequired;
  const decision = decisionFrom({ calibrated: calibratedConfidence, threshold, lowSample, recalibrationRequired, actionRisk: input.actionRisk });
  const reason = recalibrationRequired
    ? "Versao de prompt, schema, modelo ou regra mudou; recalibracao deve ser revisada antes de promocao ampla."
    : lowSample
      ? "Amostra insuficiente para confiar no segmento; usando comportamento conservador."
      : calibratedConfidence >= threshold
        ? "Confianca calibrada atende ao threshold do risco."
        : "Confianca calibrada abaixo do threshold do risco.";

  return {
    rawConfidence,
    calibratedConfidence,
    threshold,
    decision,
    confidenceKind: input.confidenceKind,
    actionRisk: input.actionRisk,
    sampleSize,
    lowSample,
    recalibrationRequired,
    conservativeFallback,
    reason,
    versions: input.versions,
    policyVersion: WHATSAPP_CONFIDENCE_CALIBRATION_VERSION,
  };
}

export function compareWhatsappCalibrationVersions(input: {
  previous: WhatsappCalibrationVersionContext;
  current: WhatsappCalibrationVersionContext;
}) {
  const changed = Object.entries(input.current)
    .filter(([key, value]) => input.previous[key as keyof WhatsappCalibrationVersionContext] !== value)
    .map(([key]) => key as keyof WhatsappCalibrationVersionContext);
  return {
    changed,
    recalibrationRequired: changed.some(key => ["promptVersion", "schemaVersion", "modelName", "ruleVersion", "calibratorVersion", "thresholdPolicyVersion"].includes(key)),
    reason: changed.length > 0 ? "Mudanca de versao pode invalidar calibracao anterior." : "Calibracao permanece compativel com as versoes ativas.",
    policyVersion: WHATSAPP_CONFIDENCE_CALIBRATION_VERSION,
  };
}
