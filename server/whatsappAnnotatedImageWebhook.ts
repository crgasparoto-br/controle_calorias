import { Request, Response } from "express";
import { generateImage, type GenerateImageResponse } from "./_core/imageGeneration";
import { buildSavedMedia, confirmPendingMeal, createPendingMealInference, getHabitSnapshots, getUserDayMealTotals, getUserIdByWhatsappPhone, getUserNutritionGoal, logInferenceEvent } from "./db";
import { buildWhatsAppMealReplyMessage } from "./modules/whatsapp/replyMessages";
import {
  extractWhatsAppWebhookMessages,
  formatDateKeyInSaoPaulo,
  getExtractedWhatsAppMessageKey,
  isWhatsAppMessageForConfiguredChannel,
  resolveWhatsAppMessageOccurredAt,
  sendWhatsAppTextMessage,
  type ExtractedWhatsAppWebhookMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import { MealProcessingResult, processMealInput } from "./nutritionEngine";
import { storagePut } from "./storage";
import { requireWhatsAppMediaConfig, requireWhatsAppSendConfig } from "./whatsappConfig";
import { handleWhatsAppWebhook } from "./whatsappWebhook";

type SavedMedia = ReturnType<typeof buildSavedMedia>;

type PreparedImageMessage = {
  text?: string;
  imageUrl?: string;
  imageAnalysisUrl: string;
  media: SavedMedia[];
  storageWarning?: string;
};

const recentlyHandledAnnotatedImageMessageIds = new Map<string, number>();
const ANNOTATED_IMAGE_DEDUPLICATION_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_STORAGE_WARNING = "Falha ao persistir mídia recebida do WhatsApp; processamento seguirá com mídia inline.";
const PROCESSING_ERROR_REPLY = "Não consegui processar essa imagem agora. Tente enviar novamente ou descreva os alimentos em texto para eu registrar.";

function getTextBody(message: WhatsAppWebhookMessage) {
  return message.text?.body?.trim() || message.image?.caption?.trim() || "";
}

function canHandleAnnotatedImageMessage(message: WhatsAppWebhookMessage) {
  return Boolean(message.image?.id && !message.audio?.id);
}

function pruneRecentlyHandledAnnotatedImageMessageIds(now = Date.now()) {
  for (const [messageId, expiresAt] of recentlyHandledAnnotatedImageMessageIds) {
    if (expiresAt <= now) {
      recentlyHandledAnnotatedImageMessageIds.delete(messageId);
    }
  }
}

function wasAnnotatedImageMessageAlreadyHandled(messageId?: string) {
  if (!messageId) {
    return false;
  }

  const now = Date.now();
  pruneRecentlyHandledAnnotatedImageMessageIds(now);
  return recentlyHandledAnnotatedImageMessageIds.has(messageId);
}

function markAnnotatedImageMessageHandled(messageId?: string) {
  if (messageId) {
    recentlyHandledAnnotatedImageMessageIds.set(messageId, Date.now() + ANNOTATED_IMAGE_DEDUPLICATION_TTL_MS);
  }
}

function formatMacro(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatReplyTime(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatFoodDescription(item: MealProcessingResult["items"][number]) {
  const portionHasGrams = /\d\s*g\b/i.test(item.portionText);
  const gramsLabel = !portionHasGrams && item.estimatedGrams > 0 ? ` (aprox. ${formatMacro(item.estimatedGrams)}g)` : "";
  return `${item.portionText}${gramsLabel} ${item.foodName}`.trim();
}

function imageDataFromDataUrl(dataUrl?: string) {
  const match = dataUrl?.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], b64Json: match[2] };
}

function buildAnnotatedMealImagePrompt(processed: MealProcessingResult) {
  const labels = processed.items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.foodName}: ${formatMacro(item.calories)} kcal, P ${formatMacro(item.protein)}g, C ${formatMacro(item.carbs)}g, G ${formatMacro(item.fat)}g`)
    .join("\n");

  return [
    "Edite a foto original da refeição adicionando legendas visuais sobre os alimentos identificados, no estilo de análise nutricional da imagem de referência.",
    "Use etiquetas verdes translúcidas com texto grande e linhas discretas apontando para cada alimento quando fizer sentido.",
    "Cada legenda deve mostrar nome do alimento, calorias e macronutrientes no formato P/C/G em gramas.",
    "Mantenha a foto realista, preserve o prato original e não adicione alimentos novos.",
    "Use texto em português do Brasil, grande e legível em celular.",
    `Itens detectados:\n${labels || "Alimentos identificados na refeição."}`,
  ].join("\n");
}

function buildMealCardsImagePrompt(processed: MealProcessingResult) {
  const labels = processed.items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.foodName}: ${formatFoodDescription(item)}, ${formatMacro(item.calories)} kcal, proteína ${formatMacro(item.protein)}g, carboidratos ${formatMacro(item.carbs)}g, gorduras ${formatMacro(item.fat)}g`)
    .join("\n");

  return [
    "Crie uma imagem quadrada com cards nutricionais limpos e legíveis para celular.",
    "Use fundo claro, cards organizados, ícones simples de comida e texto em português do Brasil.",
    "Cada card deve mostrar alimento, porção, calorias e macronutrientes P/C/G.",
    "Não inclua foto real nem alimentos novos; use apenas os dados abaixo.",
    `Refeição: ${processed.detectedMealLabel || "Refeição"}`,
    `Total: ${formatMacro(processed.totals.calories)} kcal | P ${formatMacro(processed.totals.protein)}g | C ${formatMacro(processed.totals.carbs)}g | G ${formatMacro(processed.totals.fat)}g`,
    `Itens:\n${labels || "Alimentos identificados na refeição."}`,
  ].join("\n");
}

async function generateAnnotatedMealImage(processed: MealProcessingResult, prepared: PreparedImageMessage): Promise<GenerateImageResponse> {
  const sourceImage = imageDataFromDataUrl(prepared.imageAnalysisUrl);
  if (!processed.items.length) {
    return { skippedReason: "no_prompt" };
  }

  if (sourceImage) {
    const editedImage = await generateImage({
      prompt: buildAnnotatedMealImagePrompt(processed),
      originalImages: [sourceImage],
    });

    if (editedImage.url) {
      return editedImage;
    }
  }

  return generateImage({
    prompt: buildMealCardsImagePrompt(processed),
  });
}

function buildAnnotatedImageMedia(annotatedImage: GenerateImageResponse) {
  if (!annotatedImage.url || !annotatedImage.storageKey) {
    return null;
  }

  return buildSavedMedia({
    mediaType: "image",
    storageKey: annotatedImage.storageKey,
    storageUrl: annotatedImage.url,
    mimeType: annotatedImage.mimeType || "image/png",
    originalFileName: "whatsapp-annotated-meal.png",
  });
}

async function getWhatsAppMealGoalProgress(userId: number, occurredAt: Date) {
  const [goalSummary, dayTotals] = await Promise.all([
    getUserNutritionGoal(userId),
    getUserDayMealTotals(userId, formatDateKeyInSaoPaulo(occurredAt)),
  ]);

  return {
    consumedCalories: dayTotals.totals.calories,
    goalCalories: goalSummary.today.calories,
  };
}

async function sendWhatsAppImageMessage(to: string, imageUrl: string, caption: string) {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de imagem.",
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: {
          link: imageUrl,
          caption,
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} no envio da imagem anotada.`,
      };
    }

    return {
      ok: true,
      detail: "Imagem anotada enviada com sucesso.",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar imagem anotada do WhatsApp.",
    };
  }
}

async function markWhatsAppMessageAsRead(messageId?: string) {
  if (!messageId) {
    return { ok: true, detail: "Mensagem sem ID para marcar como lida." };
  }

  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para marcar mensagem como lida.",
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} ao marcar mensagem como lida.`,
      };
    }

    return {
      ok: true,
      detail: "Mensagem marcada como lida.",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao marcar mensagem do WhatsApp como lida.",
    };
  }
}

async function getMediaDownloadUrl(mediaId: string) {
  const { accessToken } = await requireWhatsAppMediaConfig();

  const response = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Falha ao obter URL da mídia do WhatsApp: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { url?: string; mime_type?: string };
  if (!payload.url) {
    throw new Error("A API do WhatsApp não retornou a URL da mídia.");
  }

  return { url: payload.url, mimeType: payload.mime_type };
}

async function downloadWhatsAppMedia(mediaId: string, fallbackMimeType?: string) {
  const { accessToken } = await requireWhatsAppMediaConfig();

  const meta = await getMediaDownloadUrl(mediaId);
  const response = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar mídia do WhatsApp: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    mimeType: response.headers.get("content-type") || meta.mimeType || fallbackMimeType || "application/octet-stream",
  };
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "bin";
}

function buildMediaDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function prepareImageMessage(message: WhatsAppWebhookMessage, sourcePhone: string): Promise<PreparedImageMessage> {
  const imageId = message.image?.id;
  if (!imageId) {
    throw new Error("Mensagem sem imagem para processamento anotado.");
  }

  const downloaded = await downloadWhatsAppMedia(imageId, message.image?.mime_type);
  const imageAnalysisUrl = buildMediaDataUrl(downloaded.buffer, downloaded.mimeType);
  const extension = extensionFromMimeType(downloaded.mimeType);
  const fileName = `${sourcePhone}-${imageId}.${extension}`;
  const prepared: PreparedImageMessage = {
    text: getTextBody(message) || undefined,
    imageAnalysisUrl,
    media: [],
  };

  try {
    const stored = await storagePut(`whatsapp/image/${fileName}`, downloaded.buffer, downloaded.mimeType);
    const savedMedia = buildSavedMedia({
      mediaType: "image",
      storageKey: stored.key,
      storageUrl: stored.url,
      mimeType: downloaded.mimeType,
      originalFileName: fileName,
    });
    prepared.media.push(savedMedia);
    prepared.imageUrl = savedMedia.storageUrl;
  } catch {
    prepared.storageWarning = MEDIA_STORAGE_WARNING;
  }

  return prepared;
}

function clonePayloadWithoutHandledMessages(payload: any, handledMessageKeys: Set<string>) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];
  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      if (!Array.isArray(entry?.changes)) {
        return entry;
      }

      const changes = entry.changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          const pendingMessages = messages.filter(
            (_message: WhatsAppWebhookMessage, messageIndex: number) => !handledMessageKeys.has(getExtractedWhatsAppMessageKey({
              entryIndex,
              changeIndex,
              messageIndex,
            })),
          );
          return {
            ...change,
            value: {
              ...change.value,
              messages: pendingMessages,
            },
          };
        })
        .filter((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0);

      return {
        ...entry,
        changes,
      };
    })
    .filter((entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0);

  return cloned;
}

async function logWhatsAppOperationWarning(input: {
  userId: number;
  eventType: string;
  detail: string;
}) {
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "warning",
    eventType: input.eventType,
    detail: `Falha ao processar operação automática do WhatsApp: ${input.detail}`,
  });
}

async function tryHandleAnnotatedImageMessage(message: ExtractedWhatsAppWebhookMessage) {
  const sourcePhone = message.from || "unknown";
  if (!isWhatsAppMessageForConfiguredChannel(message) || !canHandleAnnotatedImageMessage(message)) {
    return false;
  }

  if (wasAnnotatedImageMessageAlreadyHandled(message.id)) {
    return true;
  }

  let userId: number | null = null;

  try {
    userId = await getUserIdByWhatsappPhone(sourcePhone);
    if (!userId) {
      return false;
    }

    const readResult = await markWhatsAppMessageAsRead(message.id);
    if (!readResult.ok) {
      await logWhatsAppOperationWarning({
        userId,
        eventType: "whatsapp.read_receipt_failed",
        detail: readResult.detail,
      });
    }

    const acknowledgementResult = await sendWhatsAppTextMessage(sourcePhone, "Recebi sua imagem e estou processando.");
    if (!acknowledgementResult.ok) {
      await logWhatsAppOperationWarning({
        userId,
        eventType: "whatsapp.processing_ack_failed",
        detail: acknowledgementResult.detail,
      });
    }

    const prepared = await prepareImageMessage(message, sourcePhone);
    if (prepared.storageWarning) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.media_storage_warning",
        detail: prepared.storageWarning,
      });
    }

    const processed = await processMealInput({
      text: prepared.text,
      imageUrl: prepared.imageAnalysisUrl || prepared.imageUrl,
      habits: await getHabitSnapshots(userId),
    });
    const processedForPersistence = {
      ...processed,
      imageUrl: prepared.imageUrl,
    };

    const annotatedImage = await generateAnnotatedMealImage(processedForPersistence, prepared);
    const annotatedMedia = buildAnnotatedImageMedia(annotatedImage);
    if (annotatedMedia) {
      prepared.media.push(annotatedMedia);
    } else if (annotatedImage.url) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_not_persisted",
        detail: "Imagem anotada gerada sem chave de storage; envio ao WhatsApp será tentado, mas a mídia não foi vinculada à refeição.",
      });
    }

    const occurredAt = resolveWhatsAppMessageOccurredAt(message);
    const draft = createPendingMealInference(userId, "whatsapp", processedForPersistence, prepared.media);
    const savedMeal = await confirmPendingMeal({
      draftId: draft.draftId,
      userId,
      mealLabel: processedForPersistence.detectedMealLabel || "Refeição",
      occurredAt: occurredAt.toISOString(),
      notes: prepared.text?.trim() || undefined,
      items: processedForPersistence.items,
    });

    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.message_processed",
      detail: `Mensagem imagem de ${sourcePhone} processada e refeição ${savedMeal.mealLabel} registrada automaticamente às ${formatReplyTime(occurredAt)}.`,
    });

    const replyResult = await sendWhatsAppTextMessage(
      sourcePhone,
      buildWhatsAppMealReplyMessage(processedForPersistence, {
        registeredAt: occurredAt,
        goalProgress: await getWhatsAppMealGoalProgress(userId, occurredAt),
      }),
    );

    if (!replyResult.ok) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.reply_failed",
        detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
      });
    }

    if (annotatedImage.url) {
      const imageReplyResult = await sendWhatsAppImageMessage(
        sourcePhone,
        annotatedImage.url,
        "Imagem anotada com os alimentos identificados.",
      );

      if (!imageReplyResult.ok) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "warning",
          eventType: "whatsapp.annotated_image_reply_failed",
          detail: `Falha ao enviar imagem anotada para ${sourcePhone}: ${imageReplyResult.detail}`,
        });
      }
    } else {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_skipped",
        detail: `Imagem anotada não enviada para ${sourcePhone}: ${annotatedImage.detail || annotatedImage.skippedReason || "geração sem URL"}.`,
      });
    }

    markAnnotatedImageMessageHandled(message.id);
    return true;
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "error",
      eventType: "whatsapp.processing_error",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao processar imagem do WhatsApp.",
    });

    const replyResult = await sendWhatsAppTextMessage(sourcePhone, PROCESSING_ERROR_REPLY);
    if (!replyResult.ok) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.reply_failed",
        detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
      });
    }

    markAnnotatedImageMessageHandled(message.id);
    return true;
  }
}

export async function handleWhatsAppWebhookWithAnnotatedImages(req: Request, res: Response) {
  const messages = extractWhatsAppWebhookMessages(req.body);
  if (!messages.length) {
    return handleWhatsAppWebhook(req, res);
  }

  const handledMessageKeys = new Set<string>();
  for (const message of messages) {
    const handled = await tryHandleAnnotatedImageMessage(message);
    if (handled) {
      handledMessageKeys.add(getExtractedWhatsAppMessageKey(message));
    }
  }

  if (!handledMessageKeys.size) {
    return handleWhatsAppWebhook(req, res);
  }

  const remainingPayload = clonePayloadWithoutHandledMessages(req.body, handledMessageKeys);
  if (!Array.isArray(remainingPayload?.entry) || remainingPayload.entry.length === 0) {
    return res.status(200).json({ ok: true, processed: messages.length });
  }

  req.body = remainingPayload;
  return handleWhatsAppWebhook(req, res);
}
