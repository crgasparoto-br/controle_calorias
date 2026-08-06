import type { AiInferenceEvent } from "../../server/_core/ai/observability";
import { setAiObservabilitySink } from "../../server/_core/ai/observability";
import { DEFAULT_AI_PROVIDER_FACTORIES, type AiProviderFactoryMap } from "../../server/_core/ai/providerResolver";
import { transcribeAudio } from "../../server/_core/voiceTranscription";
import {
  createUserManualMeal,
  getDb,
  listUserMeals,
  logPersistenceWarning,
  removeUserMeal,
} from "../../server/db";
import {
  findCatalogFoodSemantic,
  findPackagedSnackByWebSearch,
  resetEmbeddingCache,
  type PackagedSnackCategory,
} from "../../server/catalogSemanticSearch";
import { extractWithAi } from "../../server/mealAiExtraction";
import { executeWhatsappAiQuestionIntent } from "../../server/modules/whatsapp/aiQuestionAssistant";
import { generateAnnotatedMealImage } from "../../server/modules/whatsapp/annotatedImage";
import { executeWhatsappDeleteIntent } from "../../server/modules/whatsapp/deleteIntent";
import { interpretWhatsappMessageWithDiagnostics } from "../../server/modules/whatsapp/intentInterpreter";
import { executeWhatsappLlmIntent } from "../../server/modules/whatsapp/llmIntentActions";
import { resolveWhatsAppPrecedenceGate } from "../../server/modules/whatsapp/messageRouter";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../server/repositories/whatsappPendingOperationRepository";
import {
  scanReportSafety,
  type CheckResult,
  type FallbackKind,
  type ProviderCall,
  type ProviderId,
  type Scenario,
  type ScenarioObservation,
} from "./contracts";
import {
  baseEnvironment,
  createProviderRuntime,
  intentContext,
  processedMeal,
  syntheticPhotoDataUrl,
} from "./provider-runtime";

function addCheck(
  checks: CheckResult[],
  name: string,
  passed: boolean,
  category: CheckResult["category"] = "functional",
): void {
  checks.push({ name, passed, category });
}

function includesInsensitive(value: unknown, expected: unknown): boolean {
  return String(value ?? "").toLocaleLowerCase("pt-BR").includes(String(expected ?? "").toLocaleLowerCase("pt-BR"));
}

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function scenarioUserId(scenario: Scenario, offset = 0): number {
  const hash = [...scenario.id].reduce((sum, character) => sum + character.codePointAt(0)!, 0);
  return 927_000 + hash * 10 + offset;
}

async function removeAllMeals(userId: number): Promise<void> {
  for (const meal of await listUserMeals(userId)) {
    await removeUserMeal(userId, meal.id);
  }
}

async function seedSyntheticMeal(userId: number): Promise<void> {
  await removeAllMeals(userId);
  await createUserManualMeal({
    userId,
    mealLabel: "Almoço",
    occurredAt: "2026-08-06T12:00:00.000Z",
    notes: "Fixture sintética de continuidade.",
    items: processedMeal().items,
  });
}

async function cancelActivePendingOperation(userId: number): Promise<void> {
  const latest = await pendingOperationRepository.getLatestPendingOperation(userId);
  if (latest?.state === "active") await pendingOperationRepository.cancelPendingOperation(latest.id);
}

function normalizedMealState(meals: Awaited<ReturnType<typeof listUserMeals>>) {
  return meals.map(meal => ({
    id: meal.id,
    label: meal.mealLabel,
    foods: meal.items.map(item => item.foodName.toLocaleLowerCase("pt-BR")).sort(),
  }));
}

async function runConversationScenario(scenario: Scenario, checks: CheckResult[]): Promise<unknown> {
  const userId = scenarioUserId(scenario);
  const siblingUserId = scenarioUserId(scenario, 1);
  const receivedAt = new Date("2026-08-06T12:00:00.000Z");
  await cancelActivePendingOperation(userId);
  await cancelActivePendingOperation(siblingUserId);
  await seedSyntheticMeal(userId);
  await seedSyntheticMeal(siblingUserId);
  const siblingBefore = normalizedMealState(await listUserMeals(siblingUserId));

  try {
    if (scenario.tags.includes("pending-operation")) {
      const requested = await executeWhatsappDeleteIntent(userId, {
        text: "Remover o arroz do almoço",
        timeZone: "America/Sao_Paulo",
        receivedAt,
        entrypoint: "issue-927-benchmark",
      });
      const pending = await pendingOperationRepository.getActivePendingOperation(userId, receivedAt);
      addCheck(checks, "pending persisted before reply", Boolean(requested && pending));

      const invalid = await resolveWhatsAppPrecedenceGate({
        userId,
        text: "talvez",
        receivedAt: new Date(receivedAt.getTime() + 1_000),
        userTimezone: "America/Sao_Paulo",
        messageId: `${scenario.id}-invalid`,
        pendingOnly: true,
      });
      const afterInvalid = await pendingOperationRepository.getActivePendingOperation(
        userId,
        new Date(receivedAt.getTime() + 1_000),
      );
      addCheck(checks, "invalid reply preserves pending", invalid.step === "pending_interaction" && afterInvalid?.id === pending?.id);

      const beforeCancel = normalizedMealState(await listUserMeals(userId));
      await resolveWhatsAppPrecedenceGate({
        userId,
        text: "CANCELAR",
        receivedAt: new Date(receivedAt.getTime() + 2_000),
        userTimezone: "America/Sao_Paulo",
        messageId: `${scenario.id}-cancel`,
        pendingOnly: true,
      });
      const latest = await pendingOperationRepository.getLatestPendingOperation(userId);
      const afterCancel = normalizedMealState(await listUserMeals(userId));
      addCheck(checks, "cancellation persisted", latest?.state === "cancelled");
      addCheck(checks, "cancel preserves domain state", JSON.stringify(afterCancel) === JSON.stringify(beforeCancel));

      await resolveWhatsAppPrecedenceGate({
        userId,
        text: "CANCELAR",
        receivedAt: new Date(receivedAt.getTime() + 3_000),
        userTimezone: "America/Sao_Paulo",
        messageId: `${scenario.id}-cancel`,
        pendingOnly: true,
      });
      addCheck(
        checks,
        "duplicate reply is idempotent",
        JSON.stringify(normalizedMealState(await listUserMeals(userId))) === JSON.stringify(afterCancel),
      );
      addCheck(
        checks,
        "tenant isolation",
        JSON.stringify(normalizedMealState(await listUserMeals(siblingUserId))) === JSON.stringify(siblingBefore),
      );
      return invalid;
    }

    if (scenario.tags.includes("deletion")) {
      await executeWhatsappDeleteIntent(userId, {
        text: String(scenario.input.text ?? "Remover o arroz do almoço"),
        timeZone: "America/Sao_Paulo",
        receivedAt,
        entrypoint: "issue-927-benchmark",
      });
      const pending = await pendingOperationRepository.getActivePendingOperation(userId, receivedAt);
      addCheck(checks, "pending persisted before reply", Boolean(pending));
      const confirmation = await resolveWhatsAppPrecedenceGate({
        userId,
        text: "SIM",
        receivedAt: new Date(receivedAt.getTime() + 1_000),
        userTimezone: "America/Sao_Paulo",
        messageId: `${scenario.id}-confirm`,
        pendingOnly: true,
      });
      const latest = await pendingOperationRepository.getLatestPendingOperation(userId);
      const mealsAfter = await listUserMeals(userId);
      addCheck(checks, "pending consumed after confirmation", latest?.state === "consumed");
      addCheck(checks, "deletion effect persisted", mealsAfter.every(meal => !meal.items.some(item => includesInsensitive(item.foodName, "arroz"))));
      await resolveWhatsAppPrecedenceGate({
        userId,
        text: "SIM",
        receivedAt: new Date(receivedAt.getTime() + 2_000),
        userTimezone: "America/Sao_Paulo",
        messageId: `${scenario.id}-confirm`,
        pendingOnly: true,
      });
      addCheck(
        checks,
        "duplicate reply is idempotent",
        JSON.stringify(normalizedMealState(await listUserMeals(userId))) === JSON.stringify(normalizedMealState(mealsAfter)),
      );
      addCheck(
        checks,
        "tenant isolation",
        JSON.stringify(normalizedMealState(await listUserMeals(siblingUserId))) === JSON.stringify(siblingBefore),
      );
      return confirmation;
    }

    const messageId = `${scenario.id}-message`;
    const first = await executeWhatsappLlmIntent(userId, {
      text: String(scenario.input.text ?? ""),
      receivedAt,
      messageId,
      userTimezone: "America/Sao_Paulo",
    });
    const firstState = normalizedMealState(await listUserMeals(userId));
    const targetFood = String(scenario.input.targetFoodName ?? "batata");
    addCheck(checks, "intent", first?.handled === true && first.action === "llm_intent_replace_food_in_meal");
    addCheck(checks, "replacement effect persisted", firstState.some(meal => meal.foods.some(food => includesInsensitive(food, targetFood))));
    await executeWhatsappLlmIntent(userId, {
      text: String(scenario.input.text ?? ""),
      receivedAt,
      messageId,
      userTimezone: "America/Sao_Paulo",
    });
    addCheck(
      checks,
      "duplicate message is idempotent",
      JSON.stringify(normalizedMealState(await listUserMeals(userId))) === JSON.stringify(firstState),
    );
    addCheck(
      checks,
      "tenant isolation",
      JSON.stringify(normalizedMealState(await listUserMeals(siblingUserId))) === JSON.stringify(siblingBefore),
    );
    return first;
  } finally {
    await cancelActivePendingOperation(userId);
    await cancelActivePendingOperation(siblingUserId);
    await removeAllMeals(userId);
    await removeAllMeals(siblingUserId);
  }
}

async function runBoundary(
  scenario: Scenario,
  env: NodeJS.ProcessEnv,
  factories: AiProviderFactoryMap,
): Promise<{ output: unknown; checks: CheckResult[]; localDegradation: boolean; source: ScenarioObservation["source"] }> {
  const checks: CheckResult[] = [];
  const expected = scenario.expected;
  let output: unknown = null;
  let localDegradation = Boolean(expected.localDegradation);
  let source: ScenarioObservation["source"] = "not-required";

  if (scenario.runner === "meal") {
    output = await extractWithAi({
      text: String(scenario.input.text ?? ""),
      ...(scenario.input.syntheticImage ? { imageUrl: await syntheticPhotoDataUrl() } : {}),
      occurredAt: "2026-08-06T12:00:00.000Z",
      timeZone: "America/Sao_Paulo",
    });
    const meal = output as Awaited<ReturnType<typeof extractWithAi>>;
    addCheck(checks, "expected outcome", expected.outcome === "unavailable" ? meal === null : meal !== null);
    if (meal) {
      if (expected.itemCount !== undefined) addCheck(checks, "item count", meal.items.length === expected.itemCount);
      if (expected.foodName) addCheck(checks, "food identity", includesInsensitive(meal.items[0]?.foodName, expected.foodName));
      if (Object.hasOwn(expected, "brand")) addCheck(checks, "brand", meal.items[0]?.brand === expected.brand);
      if (expected.quantity !== undefined) addCheck(checks, "quantity", meal.items[0]?.quantity === expected.quantity);
      if (expected.unit) addCheck(checks, "unit", meal.items[0]?.unit === expected.unit);
      if (expected.classification) {
        addCheck(checks, "embedded NOVA classification", meal.items[0]?.foodClassification.processingLevel === expected.classification);
      }
    }
  } else if (scenario.runner === "intent") {
    output = await interpretWhatsappMessageWithDiagnostics(
      String(scenario.input.text ?? ""),
      intentContext(scenario),
      { useLlm: true },
    );
    const result = output as Awaited<ReturnType<typeof interpretWhatsappMessageWithDiagnostics>>;
    addCheck(checks, "intent", expected.intent ? result.intent.intent === expected.intent : true);
    if (expected.source) addCheck(checks, "interpretation source", result.source === expected.source);
    if (scenario.tags.includes("pending-operation")) {
      addCheck(checks, "pending context preserved", intentContext(scenario).pendingClarification?.kind === "replace_food");
    }
    if (scenario.tags.includes("whatsapp-adversarial")) {
      addCheck(checks, "security guard", result.fallbackReason === "security_guard", "safety");
    }
  } else if (scenario.runner === "conversation") {
    output = await runConversationScenario(scenario, checks);
  } else if (scenario.runner === "question") {
    output = await executeWhatsappAiQuestionIntent(927, {
      text: `/${String(scenario.input.question ?? "")}`,
      receivedAt: new Date("2026-08-06T12:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });
    const result = output as Awaited<ReturnType<typeof executeWhatsappAiQuestionIntent>>;
    const toolExecuted = result?.data?.internetToolEnabled === true;
    addCheck(checks, "useful answer", Boolean(result?.reply.trim()));
    addCheck(checks, "tool execution truthfulness", toolExecuted === expected.webSearchExecuted);
    source = toolExecuted ? "verified" : "not-required";
  } else if (scenario.runner === "nutrition-search") {
    output = await findPackagedSnackByWebSearch(
      String(scenario.input.foodName ?? ""),
      scenario.input.category as PackagedSnackCategory,
    );
    const result = output as Awaited<ReturnType<typeof findPackagedSnackByWebSearch>>;
    if (expected.outcome === "no-match") {
      addCheck(checks, "ambiguity rejected", result === null);
      source = "unverified";
    } else {
      addCheck(checks, "product found", result !== null);
      if (expected.foodNameContains) addCheck(checks, "product identity", includesInsensitive(result?.name, expected.foodNameContains));
      if (expected.brand) addCheck(checks, "product brand", includesInsensitive(result?.brandName, expected.brand));
      if (expected.gramsPerServing !== undefined) addCheck(checks, "serving grams", result?.gramsPerServing === expected.gramsPerServing);
      if (expected.calories !== undefined) addCheck(checks, "calories", result?.calories === expected.calories);
      if (expected.protein !== undefined) addCheck(checks, "protein", result?.protein === expected.protein);
      if (expected.carbs !== undefined) addCheck(checks, "carbs", result?.carbs === expected.carbs);
      if (expected.fat !== undefined) addCheck(checks, "fat", result?.fat === expected.fat);
      const verified = Boolean(result?.aliases.some(alias => alias.startsWith("fonte: https://")));
      addCheck(checks, "verified source", verified === expected.verifiedSource);
      source = verified ? "verified" : "unverified";
    }
  } else if (scenario.runner === "embedding") {
    resetEmbeddingCache();
    output = await findCatalogFoodSemantic(String(scenario.input.foodName ?? ""));
    const result = output as Awaited<ReturnType<typeof findCatalogFoodSemantic>>;
    if (expected.outcome === "no-match") {
      addCheck(checks, "safe semantic degradation", result === null);
      localDegradation = true;
    } else {
      addCheck(checks, "catalog match", result !== null);
      if (expected.foodNameContains) addCheck(checks, "catalog identity", includesInsensitive(result?.name, expected.foodNameContains));
    }
    resetEmbeddingCache();
  } else if (scenario.runner === "transcription") {
    output = await transcribeAudio({
      audioBase64: Buffer.from("synthetic-audio-bytes").toString("base64"),
      mimeType: "audio/ogg",
      language: String(scenario.input.language ?? "pt"),
    }, {
      env,
      providerFactories: factories,
      observability: { origin: "system", flow: "voice_transcription" },
    });
    const result = output as Awaited<ReturnType<typeof transcribeAudio>>;
    const succeeded = !("error" in result);
    addCheck(checks, "transcription succeeded", succeeded);
    if (succeeded && expected.textContains) addCheck(checks, "critical speech terms", includesInsensitive(result.text, expected.textContains));
    if (succeeded && expected.attempts !== undefined) addCheck(checks, "bounded attempts", result.execution.attempts === expected.attempts);
  } else if (scenario.runner === "annotation") {
    const imageUrl = await syntheticPhotoDataUrl();
    output = await generateAnnotatedMealImage(processedMeal(), imageUrl, env, {
      external: {
        providerFactories: factories,
        storagePutFn: async key => ({ url: `https://storage.invalid/${key}`, key }),
      },
      local: {
        storagePutFn: async key => ({ url: `https://storage.invalid/${key}`, key }),
      },
    });
    const result = output as Awaited<ReturnType<typeof generateAnnotatedMealImage>>;
    if (expected.outcome === "disabled") {
      addCheck(checks, "annotation disabled", result.skippedReason === "disabled" && result.mode === "off");
    } else {
      addCheck(checks, "annotation artifact", Boolean(result.buffer || result.url));
      addCheck(checks, "annotation mode", result.mode === expected.mode);
      addCheck(checks, "original preserved", result.artifactKind === "photo_annotation");
      localDegradation = result.mode === "local" || result.degradation === "external_to_local";
    }
  }

  return { output, checks, localDegradation, source };
}

function deriveFallback(events: AiInferenceEvent[], calls: ProviderCall[]): FallbackKind {
  if (!events.some(event => event.callRole === "fallback")) return "none";
  return new Set(calls.map(call => call.provider)).size > 1 ? "cross-provider" : "same-provider";
}

function estimatedExecutionCost(events: AiInferenceEvent[]): number | null {
  if (events.length === 0) return 0;
  const final = events.at(-1)?.executionEstimatedCostUsd;
  return typeof final === "number" ? final : null;
}

export function deriveSafetyRegression(checks: CheckResult[]): boolean {
  return checks.some(check => check.category === "safety" && !check.passed);
}

export function derivePrivacyRegression(value: unknown): boolean {
  try {
    scanReportSafety(value);
    return false;
  } catch {
    return true;
  }
}

export async function executeScenario(
  scenario: Scenario,
  rubricCriticalChecks: readonly string[] = [],
): Promise<ScenarioObservation> {
  const env = baseEnvironment(scenario);
  const runtime = createProviderRuntime(scenario);
  const events: AiInferenceEvent[] = [];
  const previousEnv = { ...process.env };
  const previousFactories = { ...DEFAULT_AI_PROVIDER_FACTORIES };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  Object.assign(DEFAULT_AI_PROVIDER_FACTORIES, runtime.factories);
  setAiObservabilitySink(event => events.push(event));
  try {
    const boundary = await runBoundary(scenario, env, runtime.factories);
    const calls = runtime.calls.length;
    const fallback = deriveFallback(events, runtime.calls);
    const expected = scenario.expected;
    if (expected.calls !== undefined) addCheck(boundary.checks, "provider call count", calls === expected.calls);
    if (expected.geminiCalls !== undefined) {
      addCheck(boundary.checks, "gemini call count", runtime.calls.filter(call => call.provider === "gemini").length === expected.geminiCalls);
    }
    if (expected.attempts !== undefined) addCheck(boundary.checks, "attempt count", calls === expected.attempts);
    if (expected.fallback) addCheck(boundary.checks, "fallback kind", fallback === expected.fallback);
    addCheck(boundary.checks, "sequential execution", runtime.concurrency.max <= 1);
    if (scenario.tags.includes("deterministic-command")) addCheck(boundary.checks, "deterministic no-call", calls === 0);
    if (scenario.tags.includes("cross-provider-blocked")) {
      addCheck(boundary.checks, "cross-provider blocked", runtime.calls.every(call => call.provider !== "gemini"));
    }
    if (scenario.tags.includes("cross-provider-allowed")) {
      addCheck(boundary.checks, "cross-provider explicitly approved", scenario.crossProviderApproved === true && fallback === "cross-provider");
    }
    if (scenario.capability === "FOOD_CLASSIFICATION") {
      addCheck(boundary.checks, "no separate classification call", calls === 1);
    }
    if (scenario.capability === "EMBEDDING") {
      const configuredProvider = env.AI_EMBEDDING_PROVIDER ?? "openai";
      addCheck(
        boundary.checks,
        "provider/model isolation",
        runtime.calls.length === 0 || runtime.calls.every(call => call.provider === configuredProvider),
      );
    }

    const toolEvents = events.flatMap(event => event.tools);
    const providerCalls: Record<ProviderId, number> = {
      openai: runtime.calls.filter(call => call.provider === "openai").length,
      "openai-compatible": runtime.calls.filter(call => call.provider === "openai-compatible").length,
      gemini: runtime.calls.filter(call => call.provider === "gemini").length,
    };
    const criticalChecks = boundary.checks.filter(check => rubricCriticalChecks.includes(check.name));
    const observationWithoutPrivacy = {
      id: scenario.id,
      capability: scenario.capability,
      tags: scenario.tags,
      valid: boundary.checks.every(check => check.passed),
      checks: boundary.checks,
      criticalPassed: criticalChecks.filter(check => check.passed).length,
      criticalTotal: criticalChecks.length,
      falsePositive: scenario.expected.outcome === "no-match" && boundary.output !== null,
      source: boundary.source,
      latencyMs: runtime.calls.reduce((sum, call) => sum + Math.max(0, call.endedAt - call.startedAt), 0),
      timedOut: events.some(event => event.outcome === "timeout"),
      unavailable: scenario.expected.outcome === "unavailable"
        || (scenario.capability === "EMBEDDING" && scenario.expected.outcome === "no-match"),
      attempts: calls,
      fallback,
      localDegradation: boundary.localDegradation,
      calls,
      providerCalls,
      attemptDetails: events.map(event => ({
        role: event.callRole,
        provider: event.effectiveProvider,
        model: event.effectiveModel,
        outcome: event.outcome,
      })),
      fallbackCalls: events.filter(event => event.callRole === "fallback").length,
      maxConcurrency: runtime.concurrency.max,
      deterministic: scenario.tags.includes("deterministic-command"),
      toolExecuted: toolEvents.some(tool => tool.executed),
      toolUnits: toolEvents.reduce((sum, tool) => sum + (tool.billableUnits ?? 0), 0),
      estimatedCostUsd: estimatedExecutionCost(events),
      safetyRegression: deriveSafetyRegression(boundary.checks),
    };
    const privacyRegression = derivePrivacyRegression(observationWithoutPrivacy);
    const observation: ScenarioObservation = { ...observationWithoutPrivacy, privacyRegression };
    scanReportSafety(observation);
    return observation;
  } finally {
    setAiObservabilitySink(null);
    resetEmbeddingCache();
    Object.assign(DEFAULT_AI_PROVIDER_FACTORIES, previousFactories);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}
