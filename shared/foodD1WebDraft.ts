import { z } from "zod";

export const foodD1WebDraftItemSchema = z.strictObject({
  observationId: z.string().min(1).max(200),
  foodName: z.string().max(255),
  quantity: z.number().finite().positive().nullable(),
  unit: z.string().max(40).nullable(),
  disposition: z.enum(["ready", "deferred", "rejected"]),
  reasonCodes: z.array(z.string().min(1).max(80)).max(20),
  nutrition: z.strictObject({
    verified: z.boolean(),
    calories: z.number().finite().nonnegative().nullable(),
    protein: z.number().finite().nonnegative().nullable(),
    carbs: z.number().finite().nonnegative().nullable(),
    fat: z.number().finite().nonnegative().nullable(),
  }),
});

export const foodD1WebDraftSchema = z.strictObject({
  resolver: z.literal("food-v2"),
  draftId: z.string().min(1).max(80),
  operationKey: z.string().min(1).max(200),
  // Only independent new-meal drafts; label/continuation need a pinned physical item.
  entrypoint: z.enum(["text", "audio_transcript", "multimodal", "plate_image", "packaging"]),
  mealLabel: z.string().min(1).max(80),
  occurredAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  items: z.array(foodD1WebDraftItemSchema).min(1).max(80),
});

export type FoodD1WebDraftItem = z.infer<typeof foodD1WebDraftItemSchema>;
export type FoodD1WebDraft = z.infer<typeof foodD1WebDraftSchema>;
