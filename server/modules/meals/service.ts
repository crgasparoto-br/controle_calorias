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
  logPersistenceWarning,
  rebuildUserMealHabits,
  removeUserMeal,
  reuseFavoriteMeal,
  saveFavoriteMeal,
  updateUserMeal,
} from "../../db";
import { MealDraftItem, processMealInput } from "../../nutritionEngine";
import { DEFAULT_APP_TIME_ZONE, addCalendarDays, getDateKeyInTimeZone, getDateTimePartsInTimeZone, zonedDateTimeLocalToIso } from "../../../shared/timeZone";
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
  recordMealItemsCatalogUsage,
  type MealItemWithNutritionSnapshot,
} from "./nutritionSnapshot";

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

function normalizeTemporalText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function padTemporalPart(value: number) {
  return String(value).padStart(2, "0");
}

function resolveSuggestedOccurredAtFromText(
  text?: string | null,
  referenceDate = new Date(),
  timeZone = DEFAULT_APP_TIME_ZONE,
) {
  const normalized = normalizeTemporalText(text ?? "");
  if (!normalized) {
    return null;
  }

  if (/\bhoje\b/.test(normalized)) {
    return referenceDate.toISOString();
  }

  const dayOffset = /\banteontem\b/.test(normalized) ? -2 : /\bontem\b/.test(normalized) ? -1 : null;
  if (dayOffset === null) {
    return null;
  }

  const parts = getDateTimePartsInTimeZone(referenceDate, timeZone);
  const targetDate = addCalendarDays(getDateKeyInTimeZone(referenceDate, timeZone), dayOffset);
  return zonedDateTimeLocalToIso(
    `${targetDate}T${padTemporalPart(parts.hour)}:${padTemporalPart(parts.minute)}:${padTemporalPart(parts.second)}`,
    timeZone,
  );
}

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
    { publicRead: params.type === "image" },
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

function ensureMealItems(items: Array<MealDraftItem>): Array<MealDraftItem & MealItemQuantityUnit> {
  return dedupeMealItemsByProductIdentity(
    items.map(item => normalizeMealItemQuantityUnit(item)),
  ) as Array<MealDraftItem & MealItemQuantityUnit>;
}

function ensureProcessedMealItems<T extends { items: MealDraftItem[] }>(processed: T): T {
  return {
    ...processed,
    items: ensureMealItems(processed.items),
  };
}

async function prepareMealItemsForSave(
  userId: number,
  items: Array<MealDraftItem>,
  options: { recordUsage?: boolean } = {},
) {
  return enrichMealItemsWithNutritionSnapshots(
    userId,
    ensureMealItems(items) as MealItemWithNutritionSnapshot[],
    options,
  );
}

export async function listMeals(userId: number) {
  return (await listUserMeals(userId)).map(decorateMealWithImageUrl);
}

export async function getDayTotals(userId: number, date: string, timeZone = DEFAULT_APP_TIME_ZONE) {
  return getUserDayMealTotals(userId, date, timeZone);
}

export async function createManualMeal(userId: number, input: ManualMealInput) {
  const items = await prepareMealItemsForSave(userId, input.items);
  const meal = decorateMealWithImageUrl(await createUserManualMeal({ userId, ...input, items }));
  await persistMealItemNutritionSnapshots(meal.id, items);
  return meal;
}

export type UpdateMealServiceOptions = {
  recordCatalogUsage?: boolean;
  updateHabits?: boolean;
  logEvent?: boolean;
  finalizeBatch?: {
    meals: Array<{ items: MealItemWithNutritionSnapshot[] }>;
    recordCatalogUsage?: boolean;
    throwOnHabitFailure?: boolean;
  };
};

const MEAL_UPDATE_SERVICE_OPTIONS = Symbol.for("controle_calorias.mealUpdateServiceOptions");

export async function updateMeal(userId: number, input: UpdateMealInput) {
  const options = (input as UpdateMealInput & {
    [MEAL_UPDATE_SERVICE_OPTIONS]?: UpdateMealServiceOptions;
  })[MEAL_UPDATE_SERVICE_OPTIONS] ?? {};
  const items = await prepareMealItemsForSave(userId, input.items, {
    recordUsage: options.recordCatalogUsage !== false,
  });
  const meal = decorateMealWithImageUrl(await updateUserMeal({
    userId,
    mealId: input.mealId,
    mealLabel: input.mealLabel,
    occurredAt: input.occurredAt,
    notes: input.notes,
    items,
  }, {
    updateHabits: options.updateHabits !== false,
    logEvent: options.logEvent !== false,
  }));
  await persistMealItemNutritionSnapshots(meal.id, items);

  if (options.finalizeBatch) {
    if (options.finalizeBatch.recordCatalogUsage !== false) {
      try {
        for (const batchMeal of options.finalizeBatch.meals) {
          await recordMealItemsCatalogUsage(userId, batchMeal.items);
        }
      } catch (error) {
        logPersistenceWarning("Meal batch catalog usage finalization skipped", error);
      }
    }

    try {
      await rebuildUserMealHabits(userId);
    } catch (error) {
      logPersistenceWarning("Meal batch habit rebuild skipped", error);
      if (options.finalizeBatch.throwOnHabitFailure) {
        throw error;
      }
    }
  }

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

export async function processMealDraft(
  userId: number,
  input: ProcessMealDraftInput,
  timeZone = DEFAULT_APP_TIME_ZONE,
) {
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
    occurredAt: new Date(),
    timeZone,
  }));

  const draft = createPendingMealInference(
    userId,
    input.source,
    processed,
    [resolvedImage.media, resolvedAudio.media].filter(Boolean) as NonNullable<Awaited<ReturnType<typeof uploadMedia>>>[],
  );
  const suggestedOccurredAt = resolveSuggestedOccurredAtFromText(input.text, new Date(), timeZone);

  return {
    draftId: draft.draftId,
    processed,
    media: draft.media,
    ...(suggestedOccurredAt ? { suggestedOccurredAt } : {}),
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
