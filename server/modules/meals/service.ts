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

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function normalizeTemporalText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getZonedParts(date: Date, timeZone = SAO_PAULO_TIME_ZONE): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function makeDateInTimeZone(parts: ZonedParts, timeZone = SAO_PAULO_TIME_ZONE) {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const actualParts = getZonedParts(utcGuess, timeZone);
  const desiredUtcMinutes = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 60_000;
  const actualUtcMinutes = Date.UTC(
    actualParts.year,
    actualParts.month - 1,
    actualParts.day,
    actualParts.hour,
    actualParts.minute,
    actualParts.second,
  ) / 60_000;
  const offsetMinutes = actualUtcMinutes - desiredUtcMinutes;
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function addDaysToZonedDate(parts: ZonedParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function resolveSuggestedOccurredAtFromText(text?: string | null, referenceDate = new Date()) {
  const normalized = normalizeTemporalText(text ?? "");
  if (!normalized) {
    return null;
  }

  const referenceParts = getZonedParts(referenceDate);
  if (/\banteontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -2)).toISOString();
  }
  if (/\bontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -1)).toISOString();
  }
  if (/\bhoje\b/.test(normalized)) {
    return referenceDate.toISOString();
  }

  return null;
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

async function prepareMealItemsForSave(userId: number, items: Array<MealDraftItem>) {
  return enrichMealItemsWithNutritionSnapshots(userId, ensureMealItems(items) as MealItemWithNutritionSnapshot[]);
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

  const draft = createPendingMealInference(
    userId,
    input.source,
    processed,
    [resolvedImage.media, resolvedAudio.media].filter(Boolean) as NonNullable<Awaited<ReturnType<typeof uploadMedia>>>[],
  );
  const suggestedOccurredAt = resolveSuggestedOccurredAtFromText(input.text);

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
