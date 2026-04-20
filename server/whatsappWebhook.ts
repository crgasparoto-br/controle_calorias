import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { whatsappConnections } from "../drizzle/schema";
import { storagePut } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { buildSavedMedia, createPendingMealInference, getDb, getHabitSnapshots, logInferenceEvent } from "./db";
import { MealProcessingResult, processMealInput } from "./nutritionEngine";

type WhatsAppMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
};

type PreparedMessageInput = {
  text?: string;
  transcript?: string;
  imageUrl?: string;
  audioUrl?: string;
  media: ReturnType<typeof buildSavedMedia>[];
  summary: string;
};

function getConfiguredUserId() {
  const parsed = Number(process.env.WHATSAPP_DEFAULT_USER_ID || "1");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizePhoneNumber(phone: string) {
  return phone.replace(/\D/g, "");
}

async function resolveUserIdFromPhone(sourcePhone: string) {
  const normalizedPhone = normalizePhoneNumber(sourcePhone);
  const db = await getDb();

  if (db && normalizedPhone) {
    try {
      const rows = await db.select().from(whatsappConnections).where(eq(whatsappConnections.phoneNumber, normalizedPhone)).limit(1);
      const match = rows[0];
      if (match?.userId) {
        return match.userId;
      }
    } catch {
      // mantém fallback para o usuário padrão enquanto a conexão real não estiver cadastrada
    }
  }

  return getConfiguredUserId();
}

function getVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN;
}

function getAccessToken() {
  return process.env.WHATSAPP_ACCESS_TOKEN;
}

function getPhoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID;
}

function extractMessages(payload: any): WhatsAppMessage[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any) =>
    Array.isArray(entry?.changes)
      ? entry.changes.flatMap((change: any) => (Array.isArray(change?.value?.messages) ? change.value.messages : []))
      : [],
  );
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

function getMealEmoji(mealLabel: string) {
  const normalized = mealLabel.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  if (normalized.includes("cafe")) return "☕";
  if (normalized.includes("almoco")) return "🍽️";
  if (normalized.includes("jantar")) return "🌙";
  if (normalized.includes("lanche")) return "🥪";
  return "🍎";
}

function formatFoodDescription(item: MealProcessingResult["items"][number]) {
  const portionHasGrams = /\d\s*g\b/i.test(item.portionText);
  const gramsLabel = !portionHasGrams && item.estimatedGrams > 0 ? ` (aprox. ${formatMacro(item.estimatedGrams)}g)` : "";
  return `${item.portionText}${gramsLabel} ${item.foodName}`.trim();
}

function buildWhatsAppReplyMessage(processed: MealProcessingResult, registeredAt = new Date()) {
  const mealLabel = processed.detectedMealLabel || "Refeição";
  const mealHeader = `${getMealEmoji(mealLabel)} ${mealLabel}:`;
  const timeLabel = formatReplyTime(registeredAt);

  if (!processed.items.length) {
    return [
      mealHeader,
      processed.sourceText || "Alimento não identificado.",
      `• Às ${timeLabel}`,
      `• Proteínas: ${formatMacro(processed.totals.protein)}g`,
      `• Carboidratos: ${formatMacro(processed.totals.carbs)}g`,
      `• Gorduras: ${formatMacro(processed.totals.fat)}g`,
      `• ${formatMacro(processed.totals.calories)}kcal`,
    ].join("\n");
  }

  const itemBlocks = processed.items.map((item) => [
    formatFoodDescription(item),
    `• Às ${timeLabel}`,
    `• Proteínas: ${formatMacro(item.protein)}g`,
    `• Carboidratos: ${formatMacro(item.carbs)}g`,
    `• Gorduras: ${formatMacro(item.fat)}g`,
    `• ${formatMacro(item.calories)}kcal`,
  ].join("\n"));

  return [mealHeader, "", itemBlocks.join("\n\n")].join("\n");
}

async function sendWhatsAppTextMessage(to: string, body: string) {
  const accessToken = getAccessToken();
  const phoneNumberId = getPhoneNumberId();
  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      detail: "Credenciais do WhatsApp não configuradas para envio de resposta.",
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          preview_url: false,
          body,
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} no envio da resposta automática.`,
      };
    }

    return {
      ok: true,
      detail: "Resposta automática enviada com sucesso.",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar resposta automática do WhatsApp.",
    };
  }
}

async function getMediaDownloadUrl(mediaId: string) {
  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN não configurado para download de mídia.");
  }

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
  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN não configurado para download de mídia.");
  }

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
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}

async function persistIncomingMedia(sourcePhone: string, mediaType: "image" | "audio", mediaId: string, fallbackMimeType?: string) {
  const downloaded = await downloadWhatsAppMedia(mediaId, fallbackMimeType);
  const extension = extensionFromMimeType(downloaded.mimeType);
  const fileName = `${sourcePhone}-${mediaId}.${extension}`;
  const stored = await storagePut(`whatsapp/${mediaType}/${fileName}`, downloaded.buffer, downloaded.mimeType);

  return buildSavedMedia({
    mediaType,
    storageKey: stored.key,
    storageUrl: stored.url,
    mimeType: downloaded.mimeType,
    originalFileName: fileName,
  });
}

async function prepareMessageInput(message: WhatsAppMessage, sourcePhone: string): Promise<PreparedMessageInput> {
  const prepared: PreparedMessageInput = {
    text: message.text?.body,
    media: [],
    summary: "texto",
  };

  if (message.image?.id) {
    const storedImage = await persistIncomingMedia(sourcePhone, "image", message.image.id, message.image.mime_type);
    prepared.media.push(storedImage);
    prepared.imageUrl = storedImage.storageUrl;
    prepared.summary = prepared.text ? "texto + imagem" : "imagem";
  }

  if (message.audio?.id) {
    const storedAudio = await persistIncomingMedia(sourcePhone, "audio", message.audio.id, message.audio.mime_type);
    prepared.media.push(storedAudio);
    prepared.audioUrl = storedAudio.storageUrl;
    prepared.summary = prepared.summary === "texto + imagem" || prepared.summary === "imagem"
      ? `${prepared.summary} + áudio`
      : prepared.text
        ? "texto + áudio"
        : "áudio";

    const transcription = await transcribeAudio({
      audioUrl: storedAudio.storageUrl,
      language: "pt",
      prompt: "Transcreva a refeição descrita pelo usuário em português do Brasil.",
    });

    if ("error" in transcription) {
      logInferenceEvent({
        userId: await resolveUserIdFromPhone(sourcePhone),
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.audio_transcription_warning",
        detail: transcription.details || transcription.error,
      });
    } else {
      prepared.transcript = transcription.text;
    }
  }

  return prepared;
}

function isSupportedMessage(message: WhatsAppMessage) {
  return Boolean(message.text?.body || message.image?.id || message.audio?.id);
}

export function verifyWhatsAppWebhook(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === getVerifyToken()) {
    return res.status(200).send(challenge);
  }

  return res.status(403).send("Webhook verification failed");
}

export async function handleWhatsAppWebhook(req: Request, res: Response) {
  const messages = extractMessages(req.body);

  if (!messages.length) {
    return res.status(200).json({ ok: true, processed: 0 });
  }

  for (const message of messages) {
    const sourcePhone = message.from || "unknown";

    if (!isSupportedMessage(message)) {
      logInferenceEvent({
        userId: await resolveUserIdFromPhone(sourcePhone),
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.unsupported_message",
        detail: `Mensagem recebida de ${sourcePhone} com tipo ${message.type || "desconhecido"}.`,
      });
      continue;
    }

    try {
      const userId = await resolveUserIdFromPhone(sourcePhone);
      const prepared = await prepareMessageInput(message, sourcePhone);
      const processed = await processMealInput({
        text: prepared.text,
        transcript: prepared.transcript,
        imageUrl: prepared.imageUrl,
        audioUrl: prepared.audioUrl,
        habits: await getHabitSnapshots(userId),
      });
      const draft = createPendingMealInference(userId, "whatsapp", processed, prepared.media);

      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.message_processed",
        detail: `Mensagem ${prepared.summary} de ${sourcePhone} processada. Rascunho ${draft.draftId} criado com ${processed.items.length} itens.`,
      });

      const replyResult = await sendWhatsAppTextMessage(
        sourcePhone,
        buildWhatsAppReplyMessage(processed, new Date()),
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
    } catch (error) {
      logInferenceEvent({
        userId: await resolveUserIdFromPhone(sourcePhone),
        origin: "whatsapp",
        status: "error",
        eventType: "whatsapp.processing_error",
        detail: error instanceof Error ? error.message : "Falha desconhecida ao processar webhook.",
      });
    }
  }

  return res.status(200).json({ ok: true, processed: messages.length });
}
