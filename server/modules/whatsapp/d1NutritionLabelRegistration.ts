/** WhatsApp transport for a previously verified label (not a nutrition resolver). */
import { createHash } from "node:crypto";
import * as dbRuntime from "../../db";
import { buildWhatsAppRegisteredPersistedMealReplyMessage } from "./replyMessages";
import type { WhatsappIntentResult } from "./intent/types";
import { fromTrustedD1WhatsAppMediaDataUrl } from "../foodIntelligenceV2/publicWhatsAppVisualRegistration";
import { isFoodD1NutritionLabelSelected, createFoodD1PublicNutritionLabel,
  type PublicD1NutritionLabelDependencies } from "../foodIntelligenceV2/publicNutritionLabel";
import { readD1PhysicalNutritionLabelTarget, readD1VerifiedNutritionLabelSource } from "../foodIntelligenceV2/publicNutritionLabelEvidence";
import { runFoodD1Migration } from "../foodIntelligenceV2/entrypointRunner";

/** The label channel supplies only owner ID, selected physical target, and a
 * verified WhatsApp Media API download. No unreviewed OCR is trusted. */
export function createWhatsAppD1NutritionLabelService(
  overrides: Partial<PublicD1NutritionLabelDependencies> = {},
) {
  const apply = createFoodD1PublicNutritionLabel({
    readAuthorizedContext: overrides.readAuthorizedContext ?? (async () => null),
    readTarget: overrides.readTarget ?? readD1PhysicalNutritionLabelTarget,
    readVerifiedSource: overrides.readVerifiedSource ?? readD1VerifiedNutritionLabelSource,
    run: overrides.run ?? runFoodD1Migration,
  });
  return async (input: {
    userId: number; externalMessageId: string | null;
    imageAnalysisUrl: string;
    target: { mealId: number; itemId: number };
    timeZone: string;
  }): Promise<WhatsappIntentResult | null> => {
    if (!isFoodD1NutritionLabelSelected()) return null;
    if (!input.externalMessageId?.trim()) {
      throw new Error("food-d1-whatsapp-label-message-id-required");
    }
    const { mealId, itemId: mealItemId } = input.target;
    if (![mealId, mealItemId].every(Number.isSafeInteger) ||
        mealId <= 0 || mealItemId <= 0) {
      throw new Error("food-d1-whatsapp-label-target-invalid");
    }
    const digest = createHash("sha256").update(JSON.stringify([
      input.userId, input.externalMessageId.trim(),
    ])).digest("hex");
    const result = await apply({
      userId: input.userId, timeZone: input.timeZone, source: "whatsapp",
      request: {
        mealId, mealItemId, d1OperationId: digest.slice(0,40),
        image: fromTrustedD1WhatsAppMediaDataUrl(input.imageAnalysisUrl),
      },
    });
    if (!result) throw new Error("food-d1-whatsapp-label-no-v1-replay");
    const meal = (await dbRuntime.listUserMeals(input.userId)).find(item =>
      item.id === result.mealId && item.userId === input.userId);
    if (!meal) throw new Error("food-d1-whatsapp-label-readback-unavailable");
    return {
      handled: true, action: "meal_item_replaced",
      reply: "Rótulo verificado associado ao alimento existente. " +
        buildWhatsAppRegisteredPersistedMealReplyMessage(meal, {
          registeredAt: new Date(Number(meal.occurredAt)), timeZone: input.timeZone,
        }),
      eventType: "whatsapp.food_d1.label_verified",
      detail: "Correção de rótulo vinculada ao item físico e fonte governada.",
      data: { mealId: result.mealId, itemId: result.itemId,
        resolverVersion: "v2", replayed: result.replayed },
    };
  };
}
export const tryRunPublicFoodD1WhatsAppNutritionLabel =
  createWhatsAppD1NutritionLabelService();
