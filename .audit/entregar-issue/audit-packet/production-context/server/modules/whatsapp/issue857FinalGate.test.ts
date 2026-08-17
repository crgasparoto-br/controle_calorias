import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ISSUE_857_REGRESSION_MATRIX } from "./issue857RegressionMatrix";
import { WHATSAPP_INTERACTION_REGISTRY } from "./interactionRegistry";
import { selectWhatsappInteractionComponent } from "./interactionPresentation";
import { buildWhatsAppOutboundFallbackText, type WhatsAppOutboundMessage } from "./replyContract";
import { buildWhatsAppFoodLines } from "./replyTemplates";

const REMOVED_ESTIMATION_WARNING = "⚠️ Valores nutricionais estimados pela IA.";
const REQUIRED_CLOSED_BEHAVIORS = [
  "canonical_actions",
  "interactive_component",
  "invalid_response_representation",
  "stale_without_recreation",
  "callback_idempotency",
  "cross_user_isolation",
  "transport_fallback_success",
  "transport_total_failure_without_delivery",
] as const;

function matrixByInteractionId() {
  return new Map(ISSUE_857_REGRESSION_MATRIX.map(entry => [entry.interactionId, entry]));
}

function readEvidenceFile(path: string) {
  const absolutePath = resolve(process.cwd(), path);
  expect(existsSync(absolutePath), `Missing evidence file ${path}`).toBe(true);
  return readFileSync(absolutePath, "utf8").toLowerCase();
}

describe("issue #857 final interaction gate", () => {
  it("consome diretamente todo o inventário canônico sem interação ausente ou duplicada", () => {
    const registryIds = WHATSAPP_INTERACTION_REGISTRY.map(interaction => interaction.id);
    const matrixIds = ISSUE_857_REGRESSION_MATRIX.map(entry => entry.interactionId);

    expect(WHATSAPP_INTERACTION_REGISTRY.length).toBeGreaterThan(0);
    expect(new Set(registryIds).size).toBe(registryIds.length);
    expect(new Set(matrixIds).size).toBe(matrixIds.length);
    expect(matrixIds).toEqual(registryIds);
  });

  it("distingue modalidades aplicáveis em vez de declarar cobertura universal", () => {
    const matrix = matrixByInteractionId();

    expect(matrix.get("professional_access.authorization")?.applicableModalities)
      .toEqual(["text", "callback", "standalone_outbound"]);
    expect(matrix.get("food_clarification.quantity")?.applicableModalities)
      .not.toContain("callback");
    expect(matrix.get("delete.confirmation")?.applicableModalities)
      .toContain("image_context");

    for (const entry of ISSUE_857_REGRESSION_MATRIX) {
      expect(entry.applicableModalities.length).toBeGreaterThan(0);
      expect(new Set(entry.applicableModalities).size).toBe(entry.applicableModalities.length);
    }
  });

  it("exige arquivos de teste reais e marcadores discriminantes para cada interação", () => {
    for (const entry of ISSUE_857_REGRESSION_MATRIX) {
      expect(entry.scenarioEvidence.length).toBeGreaterThanOrEqual(3);

      for (const evidence of entry.scenarioEvidence) {
        const source = readEvidenceFile(evidence.file);
        expect(source).toContain("describe(");
        expect(source).toContain("it(");
        for (const token of evidence.requiredTokens) {
          expect(source, `${entry.interactionId} is missing token ${token} in ${evidence.file}`)
            .toContain(token.toLowerCase());
        }
      }
    }
  });

  it("vincula cada interação a contratos executáveis e efeitos explícitos", () => {
    const matrix = matrixByInteractionId();

    for (const interaction of WHATSAPP_INTERACTION_REGISTRY) {
      const evidence = matrix.get(interaction.id);
      expect(evidence).toBeDefined();
      expect(evidence?.pendingType).toBe(interaction.pendingType);
      expect(evidence?.classification).toBe(interaction.classification);
      expect(evidence?.entrypoints).toEqual(interaction.entrypoints);
      expect(interaction.allowedEffects.length).toBeGreaterThan(0);
      expect(interaction.forbiddenEffects.length).toBeGreaterThan(0);
      expect(interaction.staleBehavior).toBe("reply_unavailable_request_new_command");
      expect(typeof interaction.matches).toBe("function");
      expect(typeof interaction.actions).toBe("function");
      expect(typeof interaction.classifyText).toBe("function");
      expect(typeof interaction.resolveText).toBe("function");
      expect(typeof interaction.rebuild).toBe("function");
      expect(typeof interaction.completeCallback).toBe("function");

      if (interaction.classification === "closed") {
        for (const behavior of REQUIRED_CLOSED_BEHAVIORS) {
          expect(evidence?.requiredBehaviors).toContain(behavior);
        }
      } else {
        expect(evidence?.requiredBehaviors).toContain("preserve_original_context");
        expect(evidence?.requiredBehaviors).toContain("request_only_missing_data");
        expect(evidence?.requiredBehaviors).toContain("command_word_not_persisted");
      }
    }
  });

  it("aplica texto para perguntas abertas, botões até três ações e lista a partir de quatro", () => {
    expect(selectWhatsappInteractionComponent("open", 0)).toBe("text");
    expect(selectWhatsappInteractionComponent("open", 5)).toBe("text");
    expect(selectWhatsappInteractionComponent("closed", 1)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 2)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 3)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 4)).toBe("list");
    expect(selectWhatsappInteractionComponent("closed", 8)).toBe("list");
  });

  it("exige reapresentação para toda decisão fechada e mantém perguntas abertas textuais", () => {
    for (const interaction of WHATSAPP_INTERACTION_REGISTRY) {
      if (interaction.classification === "closed") {
        expect(interaction.invalidResponse).toBe("represent_same_actions");
      } else {
        expect(interaction.invalidResponse).toBe("text_guidance");
      }
    }
  });

  it("deriva fallbacks utilizáveis sem expor IDs opacos", () => {
    const messages: WhatsAppOutboundMessage[] = [
      {
        type: "buttons",
        bodyText: "Confirme a exclusão",
        buttons: [
          { id: "wa:pending:123:confirm", title: "Confirmar" },
          { id: "wa:pending:123:cancel", title: "Cancelar" },
        ],
      },
      {
        type: "list",
        bodyText: "Escolha uma opção",
        buttonText: "Ver opções",
        sections: [{ rows: [
          { id: "wa:pending:456:first", title: "Arroz", description: "Almoço" },
          { id: "wa:pending:456:cancel", title: "Cancelar" },
        ] }],
      },
      {
        type: "cta_url",
        bodyText: "Precisa ajustar algum alimento?",
        buttonText: "Editar refeição",
        url: "https://app.test/quick-edit/token",
      },
    ];

    for (const message of messages) {
      const fallback = buildWhatsAppOutboundFallbackText(message);
      expect(fallback).toBeTruthy();
      expect(fallback).not.toContain("wa:pending:");
    }
  });

  it("registra no ambiente de CI o SHA exato do artefato executado", () => {
    if (!process.env.CI) return;

    expect(process.env.GITHUB_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(process.env.GITHUB_RUN_ID).toMatch(/^\d+$/);
    expect(process.env.GITHUB_WORKFLOW?.trim()).not.toBe("");
  });

  it("bloqueia regressão do aviso visual sem remover os dados nutricionais estimados", () => {
    const lines = buildWhatsAppFoodLines({
      foodName: "Alimento estimado",
      canonicalName: "alimento estimado",
      portionText: "1 porção",
      estimatedGrams: 100,
      calories: 120,
      protein: 4,
      carbs: 20,
      fat: 3,
      source: "heuristic",
    });

    expect(lines.join("\n")).toContain("Alimento estimado");
    expect(lines.join("\n")).toContain("120 kcal");
    expect(lines.join("\n")).not.toContain(REMOVED_ESTIMATION_WARNING);
  });
});
