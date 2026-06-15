import {
  buildSavedMedia,
  confirmPendingMeal,
  copyUserMeal,
  createPendingMealInference,
  createUserManualMeal,
  getUserDayMealTotals,
  getHabitSnapshots,
  getPendingInference,
  getPendingInferenceFromDb,
  listFavoriteMeals,
  listUserMeals,
  logInferenceEvent,
  removeUserMeal,
  reuseFavoriteMeal,
  saveFavoriteMeal,
  updateUserMeal,
} from "../../db";
import { MealDraftItem, processMealInput } from "../../nutritionEngine";
import { selectEstimatedNutritionSource } from "../../nutritionSourceMetadata";
import { storagePut } from "../../storage";
import { transcribeAudio } from "../../_core/voiceTranscription";
import {
  ConfirmMealInput,
  CopyMealInput,
  ManualMealInput,
  MediaInput,
  ProcessMealDraftInput,
  ReuseFavoriteMealInput,
  SaveFavoriteMealInput,
  UpdateMealInput,
} from "./schemas";
import { decorateMealWithImageUrl } from "./mealImageAssociations";
import { dedupeMealItemsByProductIdentity } from "./mealItemDeduplication";
import {
  enrichMealItemsWithNutritionSnapshots,
  persistMealItemNutritionSnapshots,
  type MealItemWithNutritionSnapshot,
} from "./nutritionSnapshot";
import { assertMealDraftValidForPersistence, MealDraftValidationError } from "./draftValidation";

export class MealDraftNotFoundError extends Error {
  constructor() {
    super("Rascunho não encontrado para confirmação.");
    this.name = "MealDraftNotFoundError";
  }
}

type MealItemQuantityUnit = {
  quantity: number;
  unit: string;
};

type MaybeMealItemQuantityUnit = Partial<MealItemQuantityUnit>;

function extractBase64Payload(value: string) {
  const match = value.match(/^data:(.+);base64,(.*)$/);
  return Buffer.from(match ? match[2] : value, "base64");
}

function buildInlineMediaDataUrl(media: NonNullable<MediaInput>) {
  if (media.base64.startsWith("data:")) {
    return media.base64;
  }

  return `data:${media.mimeType};base64,${media.base64}`;
}

async function uploadMedia(params: {
  userId: number;
  type: "image" | "audio";
  media?: NonNullable<MediaInput>;
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

async function resolveDraftImage(params: { userId: number; media?: MediaInput }) {
  const media = params.media;
  if (!media) {
    return { imageUrl: undefined, media: null as ReturnType<typeof buildSavedMedia> | null };
  }

  const inlineImageUrl = buildInlineMediaDataUrl(media);

  try {
    const uploadedMedia = await uploadMedia({ userId: params.userId, type: "image", media });
    return {
      imageUrl: inlineImageUrl,
      media: uploadedMedia,
    };
  } catch {
    logInferenceEvent({
      userId: params.userId,
      origin: "web",
      status: "warning",
      eventType: "meal_draft.inline_image_used",
      detail: "O draft usou a imagem inline porque o upload para storage falhou durante o processamento.",
    });

    return {
      imageUrl: inlineImageUrl,
      media: null,
    };
  }
}

async function resolveDraftAudio(params: {
  userId: number;
  source: "web" | "whatsapp";
  media?: MediaInput;
}) {
  const media = params.media;
  if (!media) {
    return {
      audioUrl: undefined,
      inlineAudioDataUrl: undefined,
      mimeType: undefined,
      media: null as ReturnType<typeof buildSavedMedia> | null,
    };
  }

  const inlineAudioDataUrl = buildInlineMediaDataUrl(media);

  try {
    const uploadedMedia = await uploadMedia({ userId: params.userId, type: "audio", media });
    return {
      audioUrl: uploadedMedia?.storageUrl,
      inlineAudioDataUrl,
      mimeType: media.mimeType,
      media: uploadedMedia,
    };
  } catch {
    logInferenceEvent({
      userId: params.userId,
      origin: params.source,
      status: "warning",
      eventType: "meal_draft.inline_audio_used",
      detail: "O draft usou o áudio inline porque o upload para storage falhou durante o processamento.",
    });

    return {
      audioUrl: undefined,
      inlineAudioDataUrl,
      mimeType: media.mimeType,
      media: null,
    };
  }
}

function parseQuantityFromPortionText(portionText: string) {
  const match = portionText.trim().match(/^(\d+(?:[,.]\d+)?)/u);
  if (!match) {
    return null;
  }

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function deriveUnitFromPortionText(portionText: string) {
  const normalized = portionText
    .trim()
    .replace(/^\d+(?:[,.]\d+)?\s*/u, "")
    .trim();

  return normalized || "porção";
}

function normalizeMealItemQuantityUnit<T extends MealDraftItem>(item: T): T & MealItemQuantityUnit {
  const quantityUnit = item as T & MaybeMealItemQuantityUnit;

  return {
    ...item,
    quantity: quantityUnit.quantity ?? parseQuantityFromPortionText(item.portionText) ?? item.servings,
    unit: quantityUnit.unit?.trim() || deriveUnitFromPortionText(item.portionText),
  };
}

function ensureMealItemNutritionSource<T extends MealDraftItem & MealItemQuantityUnit>(item: T): T {
  if (item.nutritionSource) {
    return item;
  }

  const foodName = item.canonicalName || item.foodName;
  return {
    ...item,
    nutritionSource: selectEstimatedNutritionSource({
      query: {
        foodName,
        unit: item.unit,
      },
      foodName,
      sourceType: item.source === "hybrid" ? "llm_estimate" : "generic_estimate",
    }),
  };
}

function ensureMealItems(items: Array<MealDraftItem>): Array<MealDraftItem & MealItemQuantityUnit> {
  return dedupeMealItemsByProductIdentity(
    items
      .map(item => normalizeMealItemQuantityUnit(item))
      .map(item => ensureMealItemNutritionSource(item)),
  ) as Array<MealDraftItem & MealItemQuantityUnit>;
}

function stripMealItemRuntimeMetadata<T extends MealDraftItem>(item: T): Omit<T, "nutritionSource"> {
  const { nutritionSource: _nutritionSource, ...persistableItem } = item;
  return persistableItem;
}

function stripMealItemsRuntimeMetadata<T extends MealDraftItem>(items: T[]): Array<Omit<T, "nutritionSource">> {
  return items.map(stripMealItemRuntimeMetadata);
}

function ensureProcessedMealItems<T extends { items: MealDraftItem[] }>(processed: T): T {
  return {
    ...processed,
    items: ensureMealItems(processed.items),
  };
}

async function prepareMealItemsForSave(userId: number, items: Array<MealDraftItem>) {
  const enriched = await enrichMealItemsWithNutritionSnapshots(userId, ensureMealItems(items) as MealItemWithNutritionSnapshot[]);
  return stripMealItemsRuntimeMetadata(enriched) as MealItemWithNutritionSnapshot[];
}

export async function listMeals(userId: number) {
  return (await listUserMeals(userId)).map(decorateMealWithImageUrl);
}

export async function getDayTotals(userId: number, date: string) {
  return getUserDayMealTotals(userId, date);
}

export async function createManualMeal(userId: number, input: ManualMealInput) {
  const items = await prepareMealItemsForSave(userId, input.items);
  const meal = decorateMealWithImageUrl(await createUserManualMeal({ userId, ...input, items }));
  await persistMealItemNutritionSnapshots(meal.id, items);
  return meal;
}

export async function updateMeal(userId: number, input: UpdateMealInput) {
  const items = await prepareMealItemsForSave(userId, input.items);
  const meal = decorateMealWithImageUrl(await updateUserMeal({
    userId,
    mealId: input.mealId,
    mealLabel: input.mealLabel,
    occurredAt: input.occurredAt,
    notes: input.notes,
    items,
  }));
  await persistMealItemNutritionSnapshots(meal.id, items);
  return meal;
}

export async function removeMeal(userId: number, mealId: number) {
  return removeUserMeal(userId, mealId);
}

export async function copyMeal(userId: number, input: CopyMealInput) {
  return decorateMealWithImageUrl(await copyUserMeal({ userId, ...input }));
}

export async function listMealFavorites(userId: number) {
  return listFavoriteMeals(userId);
}

export async function saveMealFavorite(userId: number, input: SaveFavoriteMealInput) {
  return saveFavoriteMeal({ userId, ...input });
}

export async function reuseMealFavorite(userId: number, input: ReuseFavoriteMealInput) {
  return decorateMealWithImageUrl(await reuseFavoriteMeal({ userId, ...input }));
}

export async function processMealDraft(userId: number, input: ProcessMealDraftInput) {
  const [resolvedImage, resolvedAudio] = await Promise.all([
    resolveDraftImage({ userId, media: input.image }),
    resolveDraftAudio({ userId, source: input.source, media: input.audio }),
  ]);

  let transcript: string | undefined;
  if (resolvedAudio.inlineAudioDataUrl) {
    const transcription = await transcribeAudio({
      audioBase64: resolvedAudio.inlineAudioDataUrl,
      mimeType: resolvedAudio.mimeType,
      language: "pt",
      prompt: "Transcreva a refeição narrada pelo usuário com foco em alimentos e porções.",
    });
    if ("error" in transcription) {
      logInferenceEvent({
        userId,
        origin: input.source,
        status: "warning",
        eventType: "audio.transcription_warning",
        detail: transcription.details || transcription.error,
      });
    } else {
      transcript = transcription.text;
    }
  }

  const processed = ensureProcessedMealItems(await processMealInput({
    text: input.text,
    transcript,
    imageUrl: resolvedImage.imageUrl,
    audioUrl: resolvedAudio.audioUrl,
    habits: await getHabitSnapshots(userId),
  }));

  try {
    assertMealDraftValidForPersistence(processed);
  } catch (error) {
    if (error instanceof MealDraftValidationError) {
      logInferenceEvent({
        userId,
        origin: input.source,
        status: "warning",
        eventType: "meal_draft.validation_blocked",
        detail: `Rascunho alimentar bloqueado antes de salvar: ${error.issues.map(issue => issue.code).join(", ")}.`,
      });
    }
    throw error;
  }

  const draft = createPendingMealInference(
    userId,
    input.source,
    processed,
    [resolvedImage.media, resolvedAudio.media].filter(Boolean) as NonNullable<Awaited<ReturnType<typeof uploadMedia>>>[],
  );

  return {
    draftId: draft.draftId,
    processed,
    media: draft.media,
  };
}

export async function confirmMeal(userId: number, input: ConfirmMealInput) {
  const pending = getPendingInference(input.draftId) ?? await getPendingInferenceFromDb(input.draftId);
  if (!pending || pending.userId !== userId) {
    throw new MealDraftNotFoundError();
  }

  const items = await prepareMealItemsForSave(userId, input.items);
  const meal = decorateMealWithImageUrl(await confirmPendingMeal({
    draftId: input.draftId,
    userId,
    mealLabel: input.mealLabel,
    occurredAt: input.occurredAt,
    notes: input.notes,
    items,
  }));
  await persistMealItemNutritionSnapshots(meal.id, items);
  return meal;
}
