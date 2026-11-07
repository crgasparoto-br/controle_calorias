/** #1308: immutable ownership fence for WhatsApp inbound retries.
 * A failed send may redeliver a message after a native V2 write; never
 * reinterpret the identical inbound message as fresh V1 food text/image.
 */
import { createHash } from "node:crypto";
import type { FoodOperationEnvelope } from "./schemas";
import { createFoodD1RouteDbStore } from "./entrypointRouteRepository";
import {
  hashFoodD1OperationScope,
  isD1V2Route,
  type FoodD1RouteStore,
} from "./entrypointRouting";

function hashMessage(userId: number, messageId: string): string {
  if (!Number.isSafeInteger(userId) || userId <= 0 ||
      !messageId.trim() || messageId.length > 200) {
    throw new Error("food-d1-whatsapp-inbound-id-invalid");
  }
  return createHash("sha256").update(JSON.stringify([
    userId, messageId.trim(),
  ])).digest("hex");
}

export function d1WhatsAppInboundRouteKey(userId: number, messageId: string) {
  return "d1-whatsapp-" + hashMessage(userId, messageId);
}

export function createFoodD1WhatsAppReplayFence(
  store: FoodD1RouteStore = createFoodD1RouteDbStore(),
) {
  return {
    async rejectPreviouslyV2OwnedInbound(input: {
      ownerUserId: number; externalMessageId: string | null | undefined;
    }): Promise<void> {
      if (!input.externalMessageId?.trim()) return;
      const key = d1WhatsAppInboundRouteKey(input.ownerUserId, input.externalMessageId);
      const labelKey = "d1-label-" + input.ownerUserId + ":" +
        hashMessage(input.ownerUserId, input.externalMessageId).slice(0,40);
      const [route, label] = await Promise.all([
        store.readPinnedRoute(key, input.ownerUserId),
        store.readPinnedRoute(labelKey, input.ownerUserId),
      ]);
      if (isD1V2Route(route?.resolver) || isD1V2Route(label?.resolver)) {
        throw new Error("food-d1-whatsapp-inbound-already-v2-owned");
      }
    },

    async pinContinuationInbound(input: {
      ownerUserId: number; externalMessageId: string;
      envelope: FoodOperationEnvelope;
    }): Promise<void> {
      if (input.ownerUserId !== input.envelope.ownerUserId ||
          input.envelope.mealOperation?.action !== "add") {
        throw new Error("food-d1-whatsapp-continuation-fence-scope-invalid");
      }
      const key = d1WhatsAppInboundRouteKey(input.ownerUserId, input.externalMessageId);
      const bound = {
        ...input.envelope, idempotencyKey: key,
      };
      const proposed = {
        ownerUserId: input.ownerUserId, operationKey: key,
        originEntrypoint: "continuation" as const,
        resolver: "v2" as const,
        versions: { ...input.envelope.revisions },
        operationScopeHash: hashFoodD1OperationScope(bound, "whatsapp"),
      };
      const winner = await store.bindPinnedRoute(proposed);
      if (winner.ownerUserId !== proposed.ownerUserId ||
          winner.operationKey !== key ||
          winner.originEntrypoint !== "continuation" ||
          !isD1V2Route(winner.resolver) ||
          winner.operationScopeHash !== proposed.operationScopeHash ||
          JSON.stringify(winner.versions) !== JSON.stringify(proposed.versions)) {
        throw new Error("food-d1-whatsapp-continuation-fence-conflict");
      }
    },
  };
}
export const foodD1WhatsAppReplayFence = createFoodD1WhatsAppReplayFence();
