import { describe, expect, it } from "vitest";
import { WHATSAPP_TEXT_INTENT_PIPELINE_POLICY, getWhatsAppTextIntentPipelineStepKeys } from "./textIntentPipelinePolicy";

describe("WHATSAPP_TEXT_INTENT_PIPELINE_POLICY", () => {
  it("mantém a ordem de precedência das decisões textuais do WhatsApp", () => {
    expect(getWhatsAppTextIntentPipelineStepKeys()).toEqual([
      "idempotency",
      "conversation_context",
      "temporal_context",
      "safety_guard",
      "administrative_and_access_actions",
      "auxiliary_logs",
      "meal_mutations",
      "reports_and_suggestions",
      "llm_router",
      "nutrition_fallback",
    ]);
  });

  it("documenta todos os passos como fluxo compartilhado ou adaptador explícito", () => {
    expect(WHATSAPP_TEXT_INTENT_PIPELINE_POLICY).toSatisfyAll(step => {
      return Boolean(step.key && step.description && ["webhook", "simulation", "shared"].includes(step.owner));
    });
  });

  it("mantém o fallback nutricional como última decisão", () => {
    const steps = getWhatsAppTextIntentPipelineStepKeys();

    expect(steps.at(-1)).toBe("nutrition_fallback");
    expect(steps.indexOf("llm_router")).toBeLessThan(steps.indexOf("nutrition_fallback"));
    expect(steps.indexOf("meal_mutations")).toBeLessThan(steps.indexOf("reports_and_suggestions"));
  });
});
