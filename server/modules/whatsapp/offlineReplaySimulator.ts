import {
  buildExpectedWhatsappConversationActual,
  runWhatsappConversationRegressionCase,
  type WhatsappConversationPendingState,
  type WhatsappConversationRegressionActual,
  type WhatsappConversationRegressionCase,
  type WhatsappConversationRecordState,
  whatsappConversationRegressionCases,
} from "./conversationRegression";
import {
  buildExpectedWhatsappNegativeActual,
  runWhatsappNegativeEvaluationCase,
  type WhatsappNegativeEvaluationCase,
  whatsappNegativeEvaluationCases,
} from "./negativeEvaluation";
import {
  buildExpectedWhatsappRegressionActual,
  runWhatsappRegressionCase,
  type WhatsappRegressionActualOutput,
  type WhatsappRegressionCase,
  type WhatsappRegressionIssue,
  whatsappRegressionCases,
} from "./regressionDataset";
import type { WhatsappIntentName } from "./intentSchema";
import type { WhatsappMessageHistoryInputType } from "./messageHistory";

export type WhatsappOfflineReplayVersion = {
  promptVersion: string;
  ruleVersion: string;
  schemaVersion: string;
  parserVersion: string;
  modelName: string | null;
};

export type WhatsappOfflineReplayInitialState = {
  userId: number;
  timezone: string;
  pending: WhatsappConversationPendingState | null;
  historyIds: string[];
  memoryKeys: string[];
};

export type WhatsappOfflineReplayScenarioKind = "single_message" | "negative_evaluation" | "conversation";

export type WhatsappOfflineReplayScenarioResult = {
  id: string;
  kind: WhatsappOfflineReplayScenarioKind;
  intent: WhatsappIntentName | "unknown" | null;
  inputType: WhatsappMessageHistoryInputType | "multi_turn";
  stage: "router" | "validation" | "tools" | "persistence" | "conversation";
  issues: WhatsappRegressionIssue[];
};

export type WhatsappOfflineReplayReport = {
  runId: string;
  createdAt: string;
  dryRun: true;
  version: WhatsappOfflineReplayVersion;
  initialState: WhatsappOfflineReplayInitialState;
  totals: {
    scenarios: number;
    passed: number;
    failed: number;
    blockingIssues: number;
    reviewIssues: number;
  };
  byIntent: Record<string, { scenarios: number; issues: number }>;
  byInputType: Record<string, { scenarios: number; issues: number }>;
  byStage: Record<string, { scenarios: number; issues: number }>;
  effects: {
    databaseWrites: 0;
    whatsappMessagesSent: 0;
    externalToolCalls: 0;
  };
  promotion: {
    canPromote: boolean;
    reason: string;
  };
  results: WhatsappOfflineReplayScenarioResult[];
};

type RunWhatsappOfflineReplayInput = {
  runId: string;
  version: WhatsappOfflineReplayVersion;
  initialState?: Partial<WhatsappOfflineReplayInitialState>;
  singleCases?: WhatsappRegressionCase[];
  negativeCases?: WhatsappNegativeEvaluationCase[];
  conversationCases?: WhatsappConversationRegressionCase[];
  buildSingleActual?: (testCase: WhatsappRegressionCase) => WhatsappRegressionActualOutput;
  buildNegativeActual?: (testCase: WhatsappNegativeEvaluationCase) => WhatsappRegressionActualOutput;
  buildConversationActual?: (testCase: WhatsappConversationRegressionCase) => WhatsappConversationRegressionActual;
  createdAt?: Date;
};

export const WHATSAPP_OFFLINE_REPLAY_SIMULATOR_VERSION = "whatsapp-offline-replay/v1";

export const whatsappOfflineReplayExampleCases: WhatsappRegressionCase[] = [
  ...whatsappRegressionCases.filter(testCase => [
    "food-simple-rice-100g",
    "summary-report-request",
    "prompt-injection-fallback",
  ].includes(testCase.id)),
  {
    id: "replay-multiple-actions-food-and-water",
    category: "simple_food_record",
    input: { text: "almocei banana e tomei 500ml de agua", inputType: "text", anonymized: true },
    initialContext: null,
    expected: {
      intent: "add_foods_to_meal",
      schemaVersion: "whatsapp-intent-output/v1",
      entities: { foods: ["banana"], quantity: { value: 500, unit: "ml" } },
      action: "execute_multiple_actions_food_and_water",
      persistence: "save",
    },
    critical: true,
    reason: "Replay precisa representar multiplas acoes sem efeito real durante simulacao.",
    origin: "synthetic",
  },
];

function defaultInitialState(input?: Partial<WhatsappOfflineReplayInitialState>): WhatsappOfflineReplayInitialState {
  return {
    userId: input?.userId ?? 42,
    timezone: input?.timezone ?? "America/Sao_Paulo",
    pending: input?.pending ?? null,
    historyIds: input?.historyIds ?? [],
    memoryKeys: input?.memoryKeys ?? [],
  };
}

function emptyBucket() {
  return { scenarios: 0, issues: 0 };
}

function addBucket(report: Pick<WhatsappOfflineReplayReport, "byIntent" | "byInputType" | "byStage">, input: {
  intent: string;
  inputType: string;
  stage: string;
  issues: number;
}) {
  report.byIntent[input.intent] = report.byIntent[input.intent] ?? emptyBucket();
  report.byIntent[input.intent].scenarios += 1;
  report.byIntent[input.intent].issues += input.issues;

  report.byInputType[input.inputType] = report.byInputType[input.inputType] ?? emptyBucket();
  report.byInputType[input.inputType].scenarios += 1;
  report.byInputType[input.inputType].issues += input.issues;

  report.byStage[input.stage] = report.byStage[input.stage] ?? emptyBucket();
  report.byStage[input.stage].scenarios += 1;
  report.byStage[input.stage].issues += input.issues;
}

function stageFromIssues(issues: WhatsappRegressionIssue[]): WhatsappOfflineReplayScenarioResult["stage"] {
  if (issues.some(issue => issue.field.includes("finalState") || issue.field.includes("pending"))) return "conversation";
  if (issues.some(issue => issue.field.includes("persistence"))) return "persistence";
  if (issues.some(issue => issue.field.includes("action"))) return "tools";
  if (issues.some(issue => issue.field.includes("schema") || issue.field.includes("entities"))) return "validation";
  return "router";
}

function resultForSingle(testCase: WhatsappRegressionCase, issues: WhatsappRegressionIssue[]): WhatsappOfflineReplayScenarioResult {
  return {
    id: testCase.id,
    kind: "single_message",
    intent: testCase.expected.intent,
    inputType: testCase.input.inputType,
    stage: stageFromIssues(issues),
    issues,
  };
}

function resultForNegative(testCase: WhatsappNegativeEvaluationCase, issues: WhatsappRegressionIssue[]): WhatsappOfflineReplayScenarioResult {
  return {
    id: testCase.id,
    kind: "negative_evaluation",
    intent: testCase.expected.intent,
    inputType: testCase.input.inputType,
    stage: stageFromIssues(issues),
    issues,
  };
}

function resultForConversation(testCase: WhatsappConversationRegressionCase, issues: WhatsappRegressionIssue[]): WhatsappOfflineReplayScenarioResult {
  const firstTurn = testCase.turns[0];
  return {
    id: testCase.id,
    kind: "conversation",
    intent: firstTurn?.expectedCase.expected.intent ?? null,
    inputType: "multi_turn",
    stage: stageFromIssues(issues),
    issues,
  };
}

export function runWhatsappOfflineReplay(input: RunWhatsappOfflineReplayInput): WhatsappOfflineReplayReport {
  const singleCases = input.singleCases ?? whatsappOfflineReplayExampleCases;
  const negativeCases = input.negativeCases ?? whatsappNegativeEvaluationCases;
  const conversationCases = input.conversationCases ?? whatsappConversationRegressionCases;
  const results: WhatsappOfflineReplayScenarioResult[] = [];

  for (const testCase of singleCases) {
    const actual = input.buildSingleActual?.(testCase) ?? buildExpectedWhatsappRegressionActual(testCase);
    results.push(resultForSingle(testCase, runWhatsappRegressionCase(testCase, actual)));
  }

  for (const testCase of negativeCases) {
    const actual = input.buildNegativeActual?.(testCase) ?? buildExpectedWhatsappNegativeActual(testCase);
    results.push(resultForNegative(testCase, runWhatsappNegativeEvaluationCase(testCase, actual)));
  }

  for (const testCase of conversationCases) {
    const actual = input.buildConversationActual?.(testCase) ?? buildExpectedWhatsappConversationActual(testCase);
    results.push(resultForConversation(testCase, runWhatsappConversationRegressionCase(testCase, actual)));
  }

  const report: WhatsappOfflineReplayReport = {
    runId: input.runId,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    dryRun: true,
    version: input.version,
    initialState: defaultInitialState(input.initialState),
    totals: {
      scenarios: results.length,
      passed: results.filter(result => result.issues.length === 0).length,
      failed: results.filter(result => result.issues.length > 0).length,
      blockingIssues: results.flatMap(result => result.issues).filter(issue => issue.severity === "blocking").length,
      reviewIssues: results.flatMap(result => result.issues).filter(issue => issue.severity === "review").length,
    },
    byIntent: {},
    byInputType: {},
    byStage: {},
    effects: {
      databaseWrites: 0,
      whatsappMessagesSent: 0,
      externalToolCalls: 0,
    },
    promotion: {
      canPromote: true,
      reason: "Replay sem divergencias bloqueantes.",
    },
    results,
  };

  for (const result of results) {
    addBucket(report, {
      intent: result.intent ?? "unknown",
      inputType: result.inputType,
      stage: result.stage,
      issues: result.issues.length,
    });
  }

  if (report.totals.blockingIssues > 0) {
    report.promotion = {
      canPromote: false,
      reason: "Replay encontrou divergencias bloqueantes antes de promocao ou canary.",
    };
  }

  return report;
}

export function summarizeWhatsappOfflineReplayFailures(report: WhatsappOfflineReplayReport) {
  return report.results
    .filter(result => result.issues.length > 0)
    .map(result => ({
      id: result.id,
      kind: result.kind,
      stage: result.stage,
      issueCount: result.issues.length,
      blocking: result.issues.filter(issue => issue.severity === "blocking").length,
      review: result.issues.filter(issue => issue.severity === "review").length,
    }));
}

export function buildReplayFinalState(input: {
  records?: WhatsappConversationRecordState[];
  pending?: WhatsappConversationPendingState | null;
  consumedPendingIds?: string[];
  blockedUnsafePersistence?: boolean;
}) {
  return {
    records: input.records ?? [],
    pending: input.pending ?? null,
    consumedPendingIds: input.consumedPendingIds ?? [],
    blockedUnsafePersistence: input.blockedUnsafePersistence ?? true,
  };
}
