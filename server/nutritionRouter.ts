import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { transcribeAudio } from "./_core/voiceTranscription";
import {
  buildSavedMedia,
  confirmPendingMeal,
  createPendingMealInference,
  createUserExercise,
  createUserManualMeal,
  createUserWaterLog,
  getAdminSnapshot,
  getDashboardSnapshot,
  getHabitSnapshots,
  getPendingInference,
  getPendingInferenceFromDb,
  getUserNutritionGoal,
  getUserWaterGoal,
  getWeeklySummary,
  listUserExercises,
  listUserMeals,
  listUserWaterLogs,
  logInferenceEvent,
  removeUserExercise,
  removeUserMeal,
  removeUserWaterLog,
  updateUserMeal,
  updateUserWaterGoal,
  upsertNutritionGoal,
} from "./db";
import { MealDraftItem, processMealInput } from "./nutritionEngine";
import { storagePut } from "./storage";

const goalTargetSchema = z.object({
  calories: z.number().int().min(800).max(8000),
  proteinGrams: z.number().min(20).max(500),
  carbsGrams: z.number().min(20).max(1000),
  fatGrams: z.number().min(10).max(300),
});

const goalExceptionSchema = goalTargetSchema.extend({
  id: z.number().int().positive().optional(),
  weekday: z.number().int().min(0).max(6),
  durationType: z.enum(["1_week", "2_weeks", "3_weeks", "always"]),
});

const goalSchema = z.object({
  defaultGoal: goalTargetSchema,
  exceptions: z
    .array(goalExceptionSchema)
    .refine(exceptions => new Set(exceptions.map(item => item.weekday)).size === exceptions.length, "Informe no máximo uma exceção ativa por dia da semana."),
});

const mediaInputSchema = z
  .object({
    base64: z.string().min(1),
    mimeType: z.string().min(1),
    fileName: z.string().optional(),
  })
  .optional();

const mealItemSchema = z.object({
  foodName: z.string().min(1),
  canonicalName: z.string().min(1),
  portionText: z.string().min(1),
  servings: z.number().min(0.1).max(20),
  estimatedGrams: z.number().min(0).max(5000),
  calories: z.number().min(0).max(10000),
  protein: z.number().min(0).max(1000),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(1000),
  confidence: z.number().min(0).max(1),
  source: z.enum(["catalog", "hybrid", "heuristic"]),
});

const manualMealSchema = z.object({
  mealLabel: z.string().min(1).max(80),
  occurredAt: z.string().min(1),
  notes: z.string().max(500).optional(),
  items: z.array(mealItemSchema).min(1),
});

const waterGoalSchema = z.object({
  dailyTargetMl: z.number().int().min(250).max(10000),
});

const waterLogSchema = z.object({
  amountMl: z.number().int().min(50).max(5000),
  occurredAt: z.string().min(1),
});

const exerciseSchema = z.object({
  activityType: z.string().min(2).max(120),
  durationMinutes: z.number().int().min(1).max(1440),
  caloriesBurned: z.number().min(1).max(10000),
  occurredAt: z.string().min(1),
  notes: z.string().max(500).optional(),
});

function extractBase64Payload(value: string) {
  const match = value.match(/^data:(.+);base64,(.*)$/);
  return Buffer.from(match ? match[2] : value, "base64");
}

async function uploadMedia(params: {
  userId: number;
  type: "image" | "audio";
  media?: z.infer<typeof mediaInputSchema>;
}) {
  if (!params.media) {
    return null;
  }

  const extension = params.media.mimeType.split("/")[1] || (params.type === "image" ? "jpg" : "webm");
  const keyPrefix = params.type === "image" ? "meal-images" : "meal-audios";
  const buffer = extractBase64Payload(params.media.base64);
  const upload = await storagePut(
    `${params.userId}/${keyPrefix}/${Date.now()}.${extension}`,
    buffer,
    params.media.mimeType,
  );

  return buildSavedMedia({
    mediaType: params.type,
    storageKey: upload.key,
    storageUrl: upload.url,
    mimeType: params.media.mimeType,
    originalFileName: params.media.fileName,
  });
}

function ensureMealItems(items: z.infer<typeof mealItemSchema>[]): MealDraftItem[] {
  return items.map(item => ({ ...item }));
}

export const nutritionRouter = router({
  dashboard: router({
    overview: protectedProcedure.query(async ({ ctx }) => getDashboardSnapshot(ctx.user.id)),
  }),

  goals: router({
    get: protectedProcedure.query(async ({ ctx }) => getUserNutritionGoal(ctx.user.id)),
    update: protectedProcedure.input(goalSchema).mutation(async ({ ctx, input }) => upsertNutritionGoal(ctx.user.id, input)),
  }),

  meals: router({
    list: protectedProcedure.query(async ({ ctx }) => listUserMeals(ctx.user.id)),
    createManual: protectedProcedure.input(manualMealSchema).mutation(async ({ ctx, input }) => createUserManualMeal({ userId: ctx.user.id, ...input, items: ensureMealItems(input.items) })),
    update: protectedProcedure
      .input(manualMealSchema.extend({ mealId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => updateUserMeal({ userId: ctx.user.id, mealId: input.mealId, mealLabel: input.mealLabel, occurredAt: input.occurredAt, notes: input.notes, items: ensureMealItems(input.items) })),
    remove: protectedProcedure
      .input(z.object({ mealId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => removeUserMeal(ctx.user.id, input.mealId)),
    processDraft: protectedProcedure
      .input(
        z.object({
          source: z.enum(["web", "whatsapp"]).default("web"),
          text: z.string().optional(),
          image: mediaInputSchema,
          audio: mediaInputSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const imageMedia = await uploadMedia({ userId: ctx.user.id, type: "image", media: input.image });
        const audioMedia = await uploadMedia({ userId: ctx.user.id, type: "audio", media: input.audio });

        let transcript: string | undefined;
        if (audioMedia) {
          const transcription = await transcribeAudio({
            audioUrl: audioMedia.storageUrl,
            language: "pt",
            prompt: "Transcreva a refeição narrada pelo usuário com foco em alimentos e porções.",
          });
          if ("error" in transcription) {
            logInferenceEvent({
              userId: ctx.user.id,
              origin: input.source,
              status: "warning",
              eventType: "audio.transcription_warning",
              detail: transcription.details || transcription.error,
            });
          } else {
            transcript = transcription.text;
          }
        }

        const processed = await processMealInput({
          text: input.text,
          transcript,
          imageUrl: imageMedia?.storageUrl,
          audioUrl: audioMedia?.storageUrl,
          habits: await getHabitSnapshots(ctx.user.id),
        });

        const draft = createPendingMealInference(
          ctx.user.id,
          input.source,
          processed,
          [imageMedia, audioMedia].filter(Boolean) as NonNullable<Awaited<ReturnType<typeof uploadMedia>>>[],
        );

        return {
          draftId: draft.draftId,
          processed,
          media: draft.media,
        };
      }),
    confirm: protectedProcedure
      .input(
        z.object({
          draftId: z.string().min(1),
          mealLabel: z.string().min(1),
          occurredAt: z.string().min(1),
          notes: z.string().optional(),
          items: z.array(mealItemSchema).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const pending = getPendingInference(input.draftId) ?? await getPendingInferenceFromDb(input.draftId);
        if (!pending || pending.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Rascunho não encontrado para confirmação." });
        }

        return confirmPendingMeal({
          draftId: input.draftId,
          userId: ctx.user.id,
          mealLabel: input.mealLabel,
          occurredAt: input.occurredAt,
          notes: input.notes,
          items: ensureMealItems(input.items),
        });
      }),
  }),

  exercises: router({
    list: protectedProcedure.query(async ({ ctx }) => listUserExercises(ctx.user.id)),
    create: protectedProcedure.input(exerciseSchema).mutation(async ({ ctx, input }) => createUserExercise(ctx.user.id, input)),
    remove: protectedProcedure
      .input(z.object({ exerciseId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => removeUserExercise(ctx.user.id, input.exerciseId)),
  }),

  water: router({
    goal: protectedProcedure.query(async ({ ctx }) => getUserWaterGoal(ctx.user.id)),
    updateGoal: protectedProcedure.input(waterGoalSchema).mutation(async ({ ctx, input }) => updateUserWaterGoal(ctx.user.id, input.dailyTargetMl)),
    list: protectedProcedure.query(async ({ ctx }) => listUserWaterLogs(ctx.user.id)),
    create: protectedProcedure.input(waterLogSchema).mutation(async ({ ctx, input }) => createUserWaterLog(ctx.user.id, input)),
    remove: protectedProcedure
      .input(z.object({ waterLogId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => removeUserWaterLog(ctx.user.id, input.waterLogId)),
  }),

  reports: router({
    weekly: protectedProcedure.query(async ({ ctx }) => getWeeklySummary(ctx.user.id)),
  }),

  admin: router({
    overview: adminProcedure.query(async () => getAdminSnapshot()),
  }),

  whatsapp: router({
    status: protectedProcedure.query(() => ({
      configured: Boolean(
        process.env.WHATSAPP_ACCESS_TOKEN &&
          process.env.WHATSAPP_PHONE_NUMBER_ID &&
          process.env.WHATSAPP_VERIFY_TOKEN,
      ),
      webhookPath: "/api/whatsapp/webhook",
    })),
    simulateInbound: publicProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          text: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const processed = await processMealInput({
          text: input.text,
          habits: await getHabitSnapshots(input.userId),
        });

        const draft = createPendingMealInference(input.userId, "whatsapp", processed, []);
        return {
          draftId: draft.draftId,
          processed,
        };
      }),
  }),
});
