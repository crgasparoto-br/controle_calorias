import { describe, expect, it } from "vitest";
import { buildFoodOperationEnvelopeFixture } from "./fixtures";
import type { FoodOperationEnvelope } from "./schemas";
import type { FoodD1PinnedRoute, FoodD1RouteStore } from "./entrypointRouting";
import { createFoodD1WhatsAppReplayFence, d1WhatsAppInboundRouteKey } from "./publicWhatsAppReplayFence";

function store() {
  const rows = new Map<string, FoodD1PinnedRoute>();
  const adapter: FoodD1RouteStore = {
    async readPinnedRoute(key, owner) {
      return rows.get(owner + ":" + key) ?? null;
    },
    async bindPinnedRoute(candidate) {
      const k = candidate.ownerUserId + ":" + candidate.operationKey;
      const existing = rows.get(k);
      if (existing) return existing;
      rows.set(k, candidate);
      return candidate;
    },
  };
  return { rows, adapter };
}
const envelope = buildFoodOperationEnvelopeFixture({
  ownerUserId: 7, idempotencyKey: "d1-whatsapp-original",
  traceId: "original-trace-2026-11-04",
  mealOperation: { action: "add", targetMeal: "almoço", date: "2026-11-04" },
}) as FoodOperationEnvelope;

describe("#1308 WhatsApp inbound V2 route ownership after a failed reply", () => {
  it("pins a follow-up external message ID before any commit so V1 cannot replay it", async () => {
    const { rows, adapter } = store();
    const fence = createFoodD1WhatsAppReplayFence(adapter);
    await fence.rejectPreviouslyV2OwnedInbound({
      ownerUserId: 7, externalMessageId: "wamid.followup-01",
    });
    await fence.pinContinuationInbound({
      ownerUserId: 7, externalMessageId: "wamid.followup-01", envelope,
    });
    expect(rows.size).toBe(1);
    expect(rows.values().next().value?.originEntrypoint).toBe("continuation");
    await expect(fence.rejectPreviouslyV2OwnedInbound({
      ownerUserId: 7, externalMessageId: "wamid.followup-01",
    })).rejects.toThrow("food-d1-whatsapp-inbound-already-v2-owned");
    await fence.rejectPreviouslyV2OwnedInbound({
      ownerUserId: 8, externalMessageId: "wamid.followup-01",
    });
    await fence.pinContinuationInbound({
      ownerUserId: 7, externalMessageId: "wamid.followup-01", envelope,
    });
    expect(rows.size).toBe(1);
  });

  it("rejects a changed original operation under the same WhatsApp message ID", async () => {
    const fence = createFoodD1WhatsAppReplayFence(store().adapter);
    await fence.pinContinuationInbound({
      ownerUserId: 7, externalMessageId: "wamid.followup-01", envelope,
    });
    await expect(fence.pinContinuationInbound({
      ownerUserId: 7, externalMessageId: "wamid.followup-01",
      envelope: { ...envelope, mealOperation: {
        action: "add", targetMeal: "jantar", date: "2026-11-04",
      } },
    })).rejects.toThrow("food-d1-whatsapp-continuation-fence-conflict");
    await expect(fence.pinContinuationInbound({
      ownerUserId: 8, externalMessageId: "wamid.followup-01", envelope,
    })).rejects.toThrow("food-d1-whatsapp-continuation-fence-scope-invalid");
  });

  it("rejects already pinned original image/text and label keys without inferring food", async () => {
    const { adapter } = store();
    const fence = createFoodD1WhatsAppReplayFence(adapter);
    const key = d1WhatsAppInboundRouteKey(7, "wamid.original");
    await adapter.bindPinnedRoute({
      ownerUserId: 7, operationKey: key,
      originEntrypoint: "plate_image", resolver: "v2",
      versions: { ...envelope.revisions },
      operationScopeHash: "a".repeat(64),
    });
    await expect(fence.rejectPreviouslyV2OwnedInbound({
      ownerUserId: 7, externalMessageId: "wamid.original",
    })).rejects.toThrow("food-d1-whatsapp-inbound-already-v2-owned");
    const input = "wamid.label";
    const labelHash = (await import("node:crypto")).createHash("sha256").update(JSON.stringify([
      7, input,
    ])).digest("hex");
    await adapter.bindPinnedRoute({
      ownerUserId: 7,
      operationKey: "d1-label-7:" + labelHash.slice(0,40),
      originEntrypoint: "nutrition_label", resolver: "v2",
      versions: { ...envelope.revisions },
      operationScopeHash: "b".repeat(64),
    });
    await expect(fence.rejectPreviouslyV2OwnedInbound({
      ownerUserId: 7, externalMessageId: input,
    })).rejects.toThrow("food-d1-whatsapp-inbound-already-v2-owned");
  });
});
