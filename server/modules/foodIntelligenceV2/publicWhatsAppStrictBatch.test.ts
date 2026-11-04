import { afterEach, describe, expect, it, vi } from "vitest";
import { createFoodD1PublicWhatsAppRegistration } from "./publicWhatsAppRegistration";
import type { runFoodD1Migration } from "./entrypointRunner";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";

const sha = "c".repeat(40);
const context: AuthorizedD1SimulationContext = {
  expectedAuditedBaseSha: sha,
  approval: {
    status: "approved", auditedBaseSha: sha,
    gateAReference: "fixture-gate-a", rolloutReference: "fixture-rollout",
  },
  revisions: { code: sha, knowledge: "k", lexicon: "l", policy: "p", resolver: "r" },
};
const originalGlobal = process.env.FOOD_V2_D1_ENABLED;
const originalEntrypoints = process.env.FOOD_V2_D1_ENTRYPOINTS;
afterEach(() => {
  if (originalGlobal === undefined) delete process.env.FOOD_V2_D1_ENABLED;
  else process.env.FOOD_V2_D1_ENABLED = originalGlobal;
  if (originalEntrypoints === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
  else process.env.FOOD_V2_D1_ENTRYPOINTS = originalEntrypoints;
});

function fixture(
  dispositions: Array<"ready" | "deferred">,
  declaredCount: number,
  receiptOverride: Record<string, unknown> = {},
) {
  const renderCommittedMeal = vi.fn(async () => "Almoço salvo");
  const run = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
    args.beforeCommit?.({
      items: dispositions.map(disposition => ({ disposition })),
      readyCount: dispositions.filter(item => item === "ready").length,
    } as never);
    return { committed: true, mealId: 101, operationKey: "fixed",
      recordedItemIds: [501, 502], skipped: [], ...receiptOverride };
  });
  const service = createFoodD1PublicWhatsAppRegistration({
    readAuthorizedContext: async () => context,
    readActivePending: async () => false,
    readCanonicalOperation: async () => ({
      mealType: "Almoço", date: new Date("2026-11-03T15:00:00Z"),
      itemCount: declaredCount,
    }),
    renderCommittedMeal,
    lexicon: {} as never,
    knowledge: {} as never,
    run: run as unknown as typeof runFoodD1Migration,
  });
  const invoke = () => service({
    userId: 7, originalText: "100 g arroz e 50 g feijão",
    externalMessageId: "wamid.batch-boundary",
    modality: "text", receivedAt: new Date("2026-11-03T15:00:00Z"),
    timeZone: "America/Sao_Paulo",
  });
  return { run, invoke, renderCommittedMeal };
}

describe("#1308 public WhatsApp complete-batch write boundary", () => {
  it.each([
    { title: "missing second observation", dispositions: ["ready"], declaredCount: 2 },
    { title: "deferred sibling", dispositions: ["ready", "deferred"], declaredCount: 2 },
    { title: "extra untrusted observation", dispositions: ["ready", "ready"], declaredCount: 1 },
    { title: "all deferred", dispositions: ["deferred", "deferred"], declaredCount: 2 },
  ] as const)("rejects $title before commit/readback", async ({ dispositions, declaredCount }) => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const { invoke, renderCommittedMeal } = fixture([...dispositions], declaredCount);
    await expect(invoke()).rejects.toThrow("food-d1-whatsapp-public-needs-clarification");
    expect(renderCommittedMeal).not.toHaveBeenCalled();
  });
  it.each([
    { title: "one missing receipt item", recordedItemIds: [501], skipped: [] },
    { title: "duplicate receipt IDs", recordedItemIds: [501, 501], skipped: [] },
    { title: "invalid receipt ID", recordedItemIds: [501, -2], skipped: [] },
    { title: "one skipped sibling", recordedItemIds: [501, 502],
      skipped: [{ observationId: "deferred", reasonCodes: ["needs-confirmation"] }] },
    { title: "receipt without physical IDs", recordedItemIds: null, skipped: [] },
  ])("does not claim success after an incomplete $title", async ({ recordedItemIds, skipped }) => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const { invoke, renderCommittedMeal } = fixture(["ready", "ready"], 2,
      { recordedItemIds, skipped });
    await expect(invoke()).rejects.toThrow("food-d1-whatsapp-public-commit-incomplete");
    expect(renderCommittedMeal).not.toHaveBeenCalled();
  });
  it("allows a fully ready batch with exactly two original observations", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const { invoke, renderCommittedMeal, run } = fixture(["ready", "ready"], 2);
    const result = await invoke();
    expect(result).toMatchObject({ action: "meal_item_added",
      data: { mealId: 101, skippedItemCount: 0 } });
    expect(renderCommittedMeal).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});
