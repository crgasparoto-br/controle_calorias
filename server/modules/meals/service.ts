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

export class MealDraftNotFoundError extends Error {
  constructor() {
    super("Rascunho não encontrado para confirmação.");
    this.name = "MealDraftNotFoundError";
  }
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

function ensureMealItems(items: Array<MealDraftItem>): MealDraftItem[] {
  return dedupeMealItemsByProductIdentity(items.map(item => ({ ...item })));
}

export async function listMeals(userId: number) {
  return (await listUserMeals(userId)).map(decorateMealWithImageUrl);
}

export async function getDayTotals(userId: number, date: string) {
  return getUserDayMealTotals(userId, date);
}

export async function createManualMeal(userId: number, input: ManualMealInput) {
  return decorateMealWithImageUrl(await createUserManualMeal({ userId, ...input, items: ensureMealItems(input.items) }));
}

export async function updateMeal(userId: number, input: UpdateMealInput) {
  return decorateMealWithImageUrl(await updateUserMeal({
    userId,
    mealId: input.mealId,
    mealLabel: input.mealLabel,
    occurredAt: input.occurredAt,
    notes: input.notes,
    items: ensureMealItems(input.items),
  }));
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

  const processed = await processMealInput({
    text: input.text,
    transcript,
    imageUrl: resolvedImage.imageUrl,
    audioUrl: resolvedAudio.audioUrl,
    habits: await getHabitSnapshots(userId),
  });

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

  return decorateMealWithImageUrl(await confirmPendingMeal({
    draftId: input.draftId,
    userId,
    mealLabel: input.mealLabel,
    occurredAt: input.occurredAt,
    notes: input.notes,
    items: ensureMealItems(input.items),
  }));
}
