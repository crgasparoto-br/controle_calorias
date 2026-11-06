import { calculateMealTotals } from "../../../shared/mealTotals";
import type { MealDraftItem } from "../../nutritionEngineTypes";
import type { WhatsappIntentResult } from "./intent/types";

type ImageMealResolutionContext = {
  detectedMealLabel: string;
  sourceText: string;
  transcript?: string;
  reasoning: string;
  confidence: number;
  occurredAt: string;
  media: Array<{
    id: number;
    mediaType: "image" | "audio";
    storageKey: string;
    storageUrl: string;
    mimeType: string;
    originalFileName?: string;
  }>;
};

type ImageMealTarget = { interactionId: string };
type ImageMealRecord = {
  id: number;
  userId: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string | null;
  items: MealDraftItem[];
  source?: string | null;
};
type ImageMealCreateInput = {
  detectedMealLabel: string;
  sourceText: string;
  transcript?: string;
  reasoning: string;
  confidence: number;
  occurredAt: string;
  items: MealDraftItem[];
  media: ImageMealResolutionContext["media"];
};
type ImageMealReplyInput = {
  userId: number;
  meal: ImageMealRecord;
  timeZone: string;
  options: {
    title: string;
    actionLines: string[];
    mealResultState: "updated" | "registered";
  };
};

export type ImageMealPersistenceServices = {
  createWhatsappMeal: (
    userId: number,
    input: ImageMealCreateInput,
  ) => Promise<ImageMealRecord>;
  consolidateWhatsAppMealAfterSave: (
    savedMeal: ImageMealRecord,
    timeZone: string,
  ) => Promise<{ action: "created" | "updated" | "ambiguous"; meal: ImageMealRecord }>;
  composeWhatsAppMealActionReply: (input: ImageMealReplyInput) => Promise<string>;
};

export async function persistCompletedImageMeal(
  services: ImageMealPersistenceServices,
  userId: number,
  target: ImageMealTarget,
  context: ImageMealResolutionContext,
  items: MealDraftItem[],
  timeZone: string,
  actionLine: string,
  completionDetail: string,
): Promise<WhatsappIntentResult> {
  const saved = await services.createWhatsappMeal(userId, {
    detectedMealLabel: context.detectedMealLabel,
    sourceText: context.sourceText,
    transcript: context.transcript,
    reasoning: context.reasoning,
    confidence: context.confidence,
    occurredAt: context.occurredAt,
    items,
    media: context.media,
  });
  const consolidated = await services.consolidateWhatsAppMealAfterSave(
    saved,
    timeZone,
  );
  const meal = consolidated.meal;
  const reply = await services.composeWhatsAppMealActionReply({
    userId,
    meal,
    timeZone,
    options: {
      title: "Refeição registrada",
      actionLines: [actionLine],
      mealResultState:
        consolidated.action === "updated" ? "updated" : "registered",
    },
  });
  return {
    handled: true,
    action: "food_clarification_completed",
    reply,
    eventType: "whatsapp.food_clarification.completed",
    detail: completionDetail,
    data: {
      mealId: meal.id,
      interactionId: target.interactionId,
      resolvedItemCount: items.length,
      totals: calculateMealTotals(items),
    },
  };
}
