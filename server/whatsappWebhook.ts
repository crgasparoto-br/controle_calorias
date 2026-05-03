import { and, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { whatsappConnections } from "../drizzle/schema";
import { storagePut } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { buildSavedMedia, confirmPendingMeal, createPendingMealInference, getDb, getHabitSnapshots, getWhatsAppAccessToken, listUserMeals, logInferenceEvent, relabelUserMeals } from "./db";
import { MealProcessingResult, processMealInput } from "./nutritionEngine";

type WhatsAppMessage = {
  from?: string;
  timestamp?: string;
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

type WhatsAppAction = {
  kind: "reclassify_recent_meals";
  fromMealLabel: string;
  toMealLabel: string;
};

type PendingWhatsAppConfirmation = {
  action: WhatsAppAction;
  mealIds: number[];
  createdAt: number;
  expiresAt: number;
  summary: string;
};

const pendingWhatsAppConfirmations = new Map<number, PendingWhatsAppConfirmation>();
const PENDING_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

function normalizePhoneNumber(phone: string) {
  return phone.replace(/\D/g, "");
}

async function resolveUserIdFromPhone(sourcePhone: string) {
  const normalizedPhone = normalizePhoneNumber(sourcePhone);
  const db = await getDb();

  if (db && normalizedPhone) {
    try {
      const rows = await db
        .select()
        .from(whatsappConnections)
        .where(and(eq(whatsappConnections.phoneNumber, normalizedPhone), eq(whatsappConnections.status, "active")))
        .limit(1);
      const match = rows[0];
      if (match?.userId) {
        return match.userId;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN;
}

async function getAccessToken() {
  return getWhatsAppAccessToken();
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

function resolveOccurredAt(message: WhatsAppMessage) {
  const parsed = Number(message.timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return new Date();
  }

  return new Date(String(message.timestamp).length <= 10 ? parsed * 1000 : parsed);
}

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function canonicalMealLabel(label: string) {
  const normalized = normalizeIntentText(label);
  if (normalized.includes("cafe") || normalized.includes("manha")) return "Café da manhã";
  if (normalized.includes("almoco")) return "Almoço";
  if (normalized.includes("janta")) return "Jantar";
  if (normalized.includes("lanche")) return "Lanche";
  if (normalized.includes("bebida")) return "Bebida";
  return label.trim();
}

function getTextBody(message: WhatsAppMessage) {
  return message.text?.body?.trim() ?? "";
}

function detectWhatsAppAction(message: WhatsAppMessage): WhatsAppAction | null {
  const text = getTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  const normalized = normalizeIntentText(text);
  const match = normalized.match(/(?:mudar|trocar|alterar)\s+a?\s*refeicao\s+(.+?)\s+para\s+(.+)/i);
  if (!match) {
    return null;
  }

  const fromMealLabel = canonicalMealLabel(match[1] || "");
  const toMealLabel = canonicalMealLabel(match[2] || "");
  if (!fromMealLabel || !toMealLabel || fromMealLabel === toMealLabel) {
    return null;
  }

  return {
    kind: "reclassify_recent_meals",
    fromMealLabel,
    toMealLabel,
  };
}

function isConfirmationMessage(message: WhatsAppMessage) {
  const normalized = normalizeIntentText(getTextBody(message));
  return ["sim", "confirmar", "confirma", "pode confirmar", "ok", "pode seguir"].includes(normalized);
}

function isCancellationMessage(message: WhatsAppMessage) {
  const normalized = normalizeIntentText(getTextBody(message));
  return ["nao", "não", "cancelar", "cancela", "parar", "desfazer"].includes(normalized);
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

async function handlePendingWhatsAppConfirmation(message: WhatsAppMessage, userId: number) {
  const pending = pendingWhatsAppConfirmations.get(userId);
  if (!pending) {
    return null;
  }

  if (pending.expiresAt < Date.now()) {
    pendingWhatsAppConfirmations.delete(userId);
    return {
      handled: true,
      reply: "A solicitação anterior expirou. Se ainda quiser alterar a classificação das refeições, envie o comando novamente.",
      eventType: "whatsapp.action_confirmation_expired",
      detail: `Confirmação expirada para ${pending.summary}.`,
    };
  }

  if (isCancellationMessage(message)) {
    pendingWhatsAppConfirmations.delete(userId);
    return {
      handled: true,
      reply: "Tudo certo. Não alterei nenhum registro histórico.",
      eventType: "whatsapp.action_cancelled",
      detail: `Confirmação cancelada para ${pending.summary}.`,
    };
  }

  if (!isConfirmationMessage(message)) {
    return null;
  }

  const updatedMeals = await relabelUserMeals({
    userId,
    mealIds: pending.mealIds,
    mealLabel: pending.action.toMealLabel,
    origin: "whatsapp",
  });
  pendingWhatsAppConfirmations.delete(userId);

  return {
    handled: true,
    reply: `${updatedMeals.length} registro(s) recente(s) foram alterados de ${pending.action.fromMealLabel} para ${pending.action.toMealLabel}.`,
    eventType: "whatsapp.action_applied",
    detail: `Comando confirmado e executado com sucesso: ${pending.summary} em ${updatedMeals.length} registro(s).`,
  };
}

async function handleWhatsAppAction(action: WhatsAppAction, userId: number) {
  const recentMeals = (await listUserMeals(userId))
    .filter(meal => meal.source === "whatsapp")
    .slice(0, 3);

  const matchingMeals = recentMeals.filter(
    meal => canonicalMealLabel(meal.mealLabel) === action.fromMealLabel,
  );

  if (!recentMeals.length || !matchingMeals.length) {
    return {
      handled: true,
      reply: `Não encontrei refeições recentes no WhatsApp marcadas como ${action.fromMealLabel}. Me diga quais alimentos você quer mover para ${action.toMealLabel}.`,
      eventType: "whatsapp.action_clarification_needed",
      detail: `Comando de reclassificação sem refeições recentes compatíveis: ${action.fromMealLabel} → ${action.toMealLabel}.`,
    };
  }

  if (matchingMeals.length !== recentMeals.length) {
    const recentSummary = recentMeals
      .map(meal => `${meal.mealLabel} às ${formatReplyTime(new Date(meal.occurredAt))}`)
      .join(", ");

    return {
      handled: true,
      reply: `Encontrei registros recentes com classificações diferentes (${recentSummary}). Você quer que eu mova apenas os itens marcados como ${action.fromMealLabel} ou todos os últimos ${recentMeals.length} registros para ${action.toMealLabel}?`,
      eventType: "whatsapp.action_clarification_needed",
      detail: `Comando ambíguo de reclassificação para ${action.toMealLabel}. Registros recentes: ${recentSummary}.`,
    };
  }

  const summary = `${action.fromMealLabel} → ${action.toMealLabel}`;
  pendingWhatsAppConfirmations.set(userId, {
    action,
    mealIds: matchingMeals.map(meal => meal.id),
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_CONFIRMATION_TTL_MS,
    summary,
  });

  return {
    handled: true,
    reply: `Encontrei ${matchingMeals.length} registro(s) recente(s) marcados como ${action.fromMealLabel}. Responda SIM para confirmar a mudança para ${action.toMealLabel} ou CANCELAR para desistir.`,
    eventType: "whatsapp.action_confirmation_requested",
    detail: `Confirmação solicitada para ${summary} em ${matchingMeals.length} registro(s).`,
  };
}

async function sendWhatsAppTextMessage(to: string, body: string) {
  const accessToken = await getAccessToken();
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
  const accessToken = await getAccessToken();
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
  const accessToken = await getAccessToken();
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
    const userId = await resolveUserIdFromPhone(sourcePhone);

    if (!userId) {
      logInferenceEvent({
        userId: null,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.unlinked_phone",
        detail: `Mensagem recebida de ${sourcePhone} sem vínculo ativo com um usuário da plataforma.`,
      });
      continue;
    }

    if (!isSupportedMessage(message)) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.unsupported_message",
        detail: `Mensagem recebida de ${sourcePhone} com tipo ${message.type || "desconhecido"}.`,
      });
      continue;
    }

    try {
      const pendingConfirmationResult = await handlePendingWhatsAppConfirmation(message, userId);
      if (pendingConfirmationResult) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: pendingConfirmationResult.eventType === "whatsapp.action_cancelled" ? "warning" : "success",
          eventType: pendingConfirmationResult.eventType,
          detail: pendingConfirmationResult.detail,
        });

        const replyResult = await sendWhatsAppTextMessage(sourcePhone, pendingConfirmationResult.reply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
          });
        }
        continue;
      }

      const action = detectWhatsAppAction(message);
      if (action) {
        const actionResult = await handleWhatsAppAction(action, userId);
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: actionResult.eventType === "whatsapp.action_clarification_needed" ? "warning" : "success",
          eventType: actionResult.eventType,
          detail: actionResult.detail,
        });

        const replyResult = await sendWhatsAppTextMessage(sourcePhone, actionResult.reply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
          });
        }
        continue;
      }

      const prepared = await prepareMessageInput(message, sourcePhone);
      const processed = await processMealInput({
        text: prepared.text,
        transcript: prepared.transcript,
        imageUrl: prepared.imageUrl,
        audioUrl: prepared.audioUrl,
        habits: await getHabitSnapshots(userId),
      });
      const occurredAt = resolveOccurredAt(message);
      const draft = createPendingMealInference(userId, "whatsapp", processed, prepared.media);
      const savedMeal = await confirmPendingMeal({
        draftId: draft.draftId,
        userId,
        mealLabel: processed.detectedMealLabel || "Refeição",
        occurredAt: occurredAt.toISOString(),
        notes: prepared.text?.trim() || prepared.transcript?.trim() || undefined,
        items: processed.items,
      });

      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.message_processed",
        detail: `Mensagem ${prepared.summary} de ${sourcePhone} processada e refeição ${savedMeal.mealLabel} registrada automaticamente às ${formatReplyTime(occurredAt)}.`,
      });

      const replyResult = await sendWhatsAppTextMessage(
        sourcePhone,
        buildWhatsAppReplyMessage(processed, occurredAt),
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
        userId,
        origin: "whatsapp",
        status: "error",
        eventType: "whatsapp.processing_error",
        detail: error instanceof Error ? error.message : "Falha desconhecida ao processar webhook.",
      });
    }
  }

  return res.status(200).json({ ok: true, processed: messages.length });
}
