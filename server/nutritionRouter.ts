import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { transcribeAudio } from "./_core/voiceTranscription";
import {
  buildSavedMedia,
  confirmPendingMeal,
  createPendingMealInference,
  getAdminSnapshot,
  getDashboardSnapshot,
  getHabitSnapshots,
  getPendingInference,
  getPendingInferenceFromDb,
  getUserNutritionGoal,
  getWeeklySummary,
  listUserMeals,
  logInferenceEvent,
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
