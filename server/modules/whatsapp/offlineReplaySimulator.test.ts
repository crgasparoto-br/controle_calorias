import { describe, expect, it } from "vitest";
import {
  buildExpectedWhatsappConversationActual,
  whatsappConversationRegressionCases,
} from "./conversationRegression";
import {
  buildExpectedWhatsappRegressionActual,
  whatsappRegressionCases,
} from "./regressionDataset";
import {
  runWhatsappOfflineReplay,
  summarizeWhatsappOfflineReplayFailures,
  whatsappOfflineReplayExampleCases,
} from "./offlineReplaySimulator";

const replayVersion = {
  promptVersion: "whatsapp-prompt/v2-candidate",
  ruleVersion: "whatsapp-rules/v2-candidate",
  schemaVersion: "whatsapp-intent-output/v1",
  parserVersion: "whatsapp-parser/v2-candidate",
  modelName: "offline-deterministic",
};

function singleCase(id: string) {
  const testCase = whatsappRegressionCases.find(item => item.id === id)
    ?? whatsappOfflineReplayExampleCases.find(item => item.id === id);
  if (!testCase) throw new Error(`Caso nao encontrado: ${id}`);
  return testCase;
}

function conversationCase(id: string) {
  const testCase = whatsappConversationRegressionCases.find(item => item.id === id);
  if (!testCase) throw new Error(`Conversa nao encontrada: ${id}`);
  return testCase;
}

describe("whatsapp offline replay simulator", () => {
  it("executa replay dry-run sem efeitos reais", () => {
    const report = runWhatsappOfflineReplay({
      runId: "replay-green",
      version: replayVersion,
      createdAt: new Date("2026-06-16T12:00:00.000Z"),
    });

    expect(report.dryRun).toBe(true);
    expect(report.effects).toEqual({ databaseWrites: 0, whatsappMessagesSent: 0, externalToolCalls: 0 });
    expect(report.totals.scenarios).toBeGreaterThan(0);
    expect(report.totals.failed).toBe(0);
    expect(report.promotion).toEqual({
      canPromote: true,
      reason: "Replay sem divergencias bloqueantes.",
    });
  });

  it("carrega estado inicial com fuso, pendencia, historico e memoria", () => {
    const report = runWhatsappOfflineReplay({
      runId: "replay-stateful",
      version: replayVersion,
      singleCases: [],
      negativeCases: [],
      conversationCases: [],
      initialState: {
        userId: 99,
        timezone: "America/Sao_Paulo",
        pending: { id: "pending-1", kind: "option_selection", status: "active", referenceId: "options-1" },
        historyIds: ["history-1"],
        memoryKeys: ["cafe lor"],
      },
    });

    expect(report.initialState).toEqual({
      userId: 99,
      timezone: "America/Sao_Paulo",
      pending: { id: "pending-1", kind: "option_selection", status: "active", referenceId: "options-1" },
      historyIds: ["history-1"],
      memoryKeys: ["cafe lor"],
    });
  });

  it("gera relatorio de divergencia por versao, intencao, modalidade e etapa", () => {
    const rice = singleCase("food-simple-rice-100g");
    const report = runWhatsappOfflineReplay({
      runId: "replay-regression",
      version: replayVersion,
      singleCases: [rice],
      negativeCases: [],
      conversationCases: [],
      buildSingleActual: testCase => {
        const actual = buildExpectedWhatsappRegressionActual(testCase);
        actual.persistence = "do_not_save";
        return actual;
      },
    });

    expect(report.version).toEqual(replayVersion);
    expect(report.totals).toEqual(expect.objectContaining({ scenarios: 1, failed: 1, blockingIssues: 1 }));
    expect(report.byIntent.add_foods_to_meal).toEqual({ scenarios: 1, issues: 1 });
    expect(report.byInputType.text).toEqual({ scenarios: 1, issues: 1 });
    expect(report.byStage.persistence).toEqual({ scenarios: 1, issues: 1 });
    expect(report.promotion.canPromote).toBe(false);
  });

  it("valida conversas multi-turn pelo estado final", () => {
    const correction = conversationCase("conversation-correction-after-record");
    const report = runWhatsappOfflineReplay({
      runId: "replay-conversation-final-state",
      version: replayVersion,
      singleCases: [],
      negativeCases: [],
      conversationCases: [correction],
      buildConversationActual: testCase => {
        const actual = buildExpectedWhatsappConversationActual(testCase);
        actual.finalState.records = [{
          ...actual.finalState.records[0],
          foods: ["batata"],
          status: "updated",
        }];
        return actual;
      },
    });

    expect(report.totals.failed).toBe(1);
    expect(report.byStage.conversation).toEqual({ scenarios: 1, issues: 1 });
    expect(summarizeWhatsappOfflineReplayFailures(report)).toEqual([expect.objectContaining({
      id: "conversation-correction-after-record",
      kind: "conversation",
      stage: "conversation",
      blocking: 1,
    })]);
  });

  it("bloqueia promocao quando caso negativo passa a persistir", () => {
    const report = runWhatsappOfflineReplay({
      runId: "replay-negative-save",
      version: replayVersion,
      singleCases: [],
      conversationCases: [],
      buildNegativeActual: testCase => {
        const actual = buildExpectedWhatsappRegressionActual(testCase);
        actual.persistence = "save";
        actual.action = "llm_intent_add_foods_to_meal";
        return actual;
      },
    });

    expect(report.totals.failed).toBeGreaterThan(0);
    expect(report.totals.blockingIssues).toBeGreaterThan(0);
    expect(report.effects.databaseWrites).toBe(0);
    expect(report.promotion).toEqual({
      canPromote: false,
      reason: "Replay encontrou divergencias bloqueantes antes de promocao ou canary.",
    });
  });

  it("inclui exemplo de multiplas acoes sem executar efeito real", () => {
    const multiAction = singleCase("replay-multiple-actions-food-and-water");
    const report = runWhatsappOfflineReplay({
      runId: "replay-multi-action",
      version: replayVersion,
      singleCases: [multiAction],
      negativeCases: [],
      conversationCases: [],
    });

    expect(report.totals.failed).toBe(0);
    expect(report.results[0]).toEqual(expect.objectContaining({
      id: "replay-multiple-actions-food-and-water",
      intent: "add_foods_to_meal",
    }));
    expect(report.effects).toEqual({ databaseWrites: 0, whatsappMessagesSent: 0, externalToolCalls: 0 });
  });
});
