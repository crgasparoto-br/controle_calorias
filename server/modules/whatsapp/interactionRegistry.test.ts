import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDeleteConfirmationActions,
  buildDeleteSelectionActions,
} from "./deleteIntentContract";
import {
  buildFoodClarificationActions,
  buildPendingFoodClarificationTarget,
} from "./foodClarificationContract";
import { INTENT_CLARIFICATION_ACTIONS } from "./intentClarificationInteraction";
import {
  findWhatsappRegisteredInteraction,
  listWhatsappRegisteredPendingTypes,
  WHATSAPP_INTERACTION_REGISTRY,
  WHATSAPP_INTERACTION_REGISTRY_VERSION,
} from "./interactionRegistry";
import { buildMealItemSelectionActions } from "./mealItemSelectionCallback";
import { buildWhatsappPeriodReportActions } from "./periodReportClarification";
import { buildGenericConfirmationActions } from "./webhookTextCommands";

function listTypeScriptFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap(entry => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [absolute]
      : [];
  });
}

function discoverPendingTypeConstants() {
  const roots = [
    path.resolve(process.cwd(), "server/modules/whatsapp"),
    path.resolve(process.cwd(), "server/modules/professionals"),
  ];
  const values = new Set<string>();
  const pattern = /export\s+const\s+PENDING_[A-Z0-9_]+_TYPE\s*=\s*["']([^"']+)["']/g;
  for (const file of roots.flatMap(listTypeScriptFiles)) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(pattern)) values.add(match[1]);
  }
  return [...values].sort();
}

const deleteMeal = {
  kind: "delete_meal" as const,
  mealId: 10,
  mealLabel: "Almoço",
  mealOccurredAt: "2026-07-21T12:00:00.000Z",
};
const deleteSelection = {
  kind: "selection" as const,
  targetLabel: "pão",
  candidates: [
    { ...deleteMeal, kind: "delete_food_from_meal" as const, itemIndex: 0, itemName: "Pão francês" },
    { ...deleteMeal, mealId: 11, kind: "delete_food_from_meal" as const, itemIndex: 1, itemName: "Pão de queijo" },
  ],
};

describe("registro executável transversal de interações", () => {
  it("é versionado, possui IDs únicos, metadados e handlers executáveis obrigatórios", () => {
    expect(WHATSAPP_INTERACTION_REGISTRY_VERSION).toBeGreaterThanOrEqual(3);
    const ids = WHATSAPP_INTERACTION_REGISTRY.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of WHATSAPP_INTERACTION_REGISTRY) {
      expect(entry.id).toBeTruthy();
      expect(entry.pendingType).toBeTruthy();
      expect(entry.origin).toBeTruthy();
      expect(entry.entrypoints.length).toBeGreaterThan(0);
      expect(entry.reconstruction).toBeTruthy();
      expect(entry.invalidResponse).toBeTruthy();
      expect(entry.staleBehavior).toBe("reply_unavailable_request_new_command");
      expect(entry.allowedEffects.length).toBeGreaterThan(0);
      expect(entry.forbiddenEffects.length).toBeGreaterThan(0);
      expect(entry.actions).toBeTypeOf("function");
      expect(entry.rebuild).toBeTypeOf("function");
      expect(entry.completeCallback).toBeTypeOf("function");
    }
  });

  it("todo tipo de pendência exportado nos módulos alcançáveis está registrado", () => {
    const discovered = discoverPendingTypeConstants();
    expect(discovered.length).toBeGreaterThan(0);
    expect(listWhatsappRegisteredPendingTypes().sort()).toEqual(discovered);
  });

  it("roteador e registro não mantêm switch ou cadeia paralela por tipo de pendência", () => {
    const router = fs.readFileSync(
      path.resolve(process.cwd(), "server/modules/whatsapp/messageRouter.ts"),
      "utf8",
    );
    const registry = fs.readFileSync(
      path.resolve(process.cwd(), "server/modules/whatsapp/interactionRegistry.ts"),
      "utf8",
    );
    expect(router).not.toMatch(/PENDING_[A-Z0-9_]+_TYPE/);
    expect(router).not.toMatch(/switch\s*\(.*pendingOperation\.type/);
    expect(router).toContain("listWhatsappRegisteredPendingTypes");
    expect(router).toContain("completeWhatsappRegisteredCallback");
    expect(registry).not.toMatch(/switch\s*\(.*pendingOperation\.type/);
    expect(registry).not.toMatch(/pendingOperation\.type\s*===/);
    expect(registry).toContain("interaction.rebuild");
    expect(registry).toContain("interaction.completeCallback");
  });

  it("consome as ações estruturadas dos produtores sem mudar ordem ou significado", () => {
    expect(findWhatsappRegisteredInteraction("delete", deleteMeal)?.actions(deleteMeal))
      .toEqual(buildDeleteConfirmationActions());
    expect(findWhatsappRegisteredInteraction("delete", deleteSelection)?.actions(deleteSelection, { timeZone: "America/Sao_Paulo" }))
      .toEqual(buildDeleteSelectionActions(deleteSelection.candidates, "America/Sao_Paulo"));

    const mealSelection = {
      targetFood: "pão",
      contextLabel: "na última refeição",
      action: { kind: "grams_absolute" as const, grams: 100 },
      resultTitle: "Ajuste",
      candidates: [
        { mealId: 1, mealLabel: "Almoço", itemIndex: 0, itemName: "Pão francês" },
        { mealId: 2, mealLabel: "Lanche", itemIndex: 0, itemName: "Pão de queijo" },
      ],
    };
    expect(findWhatsappRegisteredInteraction("meal_item_selection", mealSelection)?.actions(mealSelection))
      .toEqual(buildMealItemSelectionActions(mealSelection.candidates));

    const generic = {
      action: { kind: "reclassify_recent_meals" as const, fromMealLabel: "Lanche", toMealLabel: "Jantar" },
      mealIds: [1],
      summary: "Lanche → Jantar",
    };
    expect(findWhatsappRegisteredInteraction("confirmation", generic)?.actions(generic))
      .toEqual(buildGenericConfirmationActions(generic));
    const scope = { ...generic, allMealIds: [1, 2], decision: "reclassify_scope" as const };
    expect(findWhatsappRegisteredInteraction("confirmation", scope)?.actions(scope))
      .toEqual(buildGenericConfirmationActions(scope));

    expect(findWhatsappRegisteredInteraction("period_report_clarification", { kind: "period_report" })?.actions({}))
      .toEqual(buildWhatsappPeriodReportActions());
    const intentClarification = {
      contractVersion: 1 as const,
      interactionId: "intent_clarification.generic" as const,
      kind: "intent_clarification" as const,
      originalText: "registrar",
      actions: [...INTENT_CLARIFICATION_ACTIONS],
    };
    expect(findWhatsappRegisteredInteraction("intent_clarification", intentClarification)?.actions(intentClarification))
      .toEqual([...INTENT_CLARIFICATION_ACTIONS]);
  });

  it("registra separadamente os contratos alimentares abertos e fechados da #855", () => {
    const request = {
      originalText: "1 iogurte natural",
      originalCandidate: "iogurte natural",
      normalizedCandidate: "iogurte natural",
      normalizationChanged: false,
      count: 1,
    };
    const quantity = buildPendingFoodClarificationTarget({
      interactionId: "food_clarification.quantity",
      request,
      pendingKind: "quantity",
      candidates: [],
      instructionText: "Qual o peso?",
      messageId: "wamid-1",
    });
    const confirmation = buildPendingFoodClarificationTarget({
      interactionId: "food_clarification.confirmation",
      request,
      pendingKind: "confirmation",
      candidates: [],
      instructionText: "Confirmar?",
      messageId: "wamid-1",
    });
    expect(findWhatsappRegisteredInteraction("food_registration_clarification", quantity)?.classification).toBe("open");
    expect(findWhatsappRegisteredInteraction("food_registration_clarification", confirmation)?.classification).toBe("closed");
    expect(findWhatsappRegisteredInteraction("food_registration_clarification", quantity)?.actions(quantity))
      .toEqual(buildFoodClarificationActions("quantity", []));
  });
});
