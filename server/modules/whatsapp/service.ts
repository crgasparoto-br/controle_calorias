import {
  getAdminWhatsAppTokenStatus,
  getUserWhatsappConnection,
  logInferenceEvent,
  upsertUserWhatsappConnection,
} from "../../db";
import { processMealDraft } from "../meals/service";
import { processProfessionalAccessWhatsappResponse } from "../professionals/service";
import {
  getMissingWhatsAppChannelConfig,
  getWhatsAppChannelConfig,
  normalizeWhatsAppPhoneNumber,
} from "../../whatsappConfig";
import { SimulateWhatsappInboundInput, WhatsappConnectionInput } from "./schemas";
import { executeWhatsAppFoodAssistantIntent } from "./foodAssistant";
import { executeWhatsappTextIntent } from "./intentActions";
import { executeWhatsappLlmIntent } from "./llmIntentActions";
import { getWhatsAppIntentLogStatus } from "./intentResult";
import { normalizeWhatsappMultimodalInput } from "./multimodalNormalizer";
import { isWhatsAppWaterOnlyText, splitWhatsAppWaterAndFoodText } from "./waterFoodText";

export class OfficialWhatsappNumberError extends Error {
  constructor() {
    super("Informe o telefone de origem do usuário final, não o número oficial fixo da solução.");
    this.name = "OfficialWhatsappNumberError";
  }
}

export async function getWhatsappStatus(userId: number) {
  const tokenStatus = await getAdminWhatsAppTokenStatus();
  const channelConfig = getWhatsAppChannelConfig();
  const missingConfig = [
    ...getMissingWhatsAppChannelConfig(channelConfig),
    ...(tokenStatus.configured ? [] : ["WHATSAPP_ACCESS_TOKEN"]),
  ];

  return {
    configured: missingConfig.length === 0,
    webhookPath: "/api/whatsapp/webhook",
    currentUserId: userId,
    connection: await getUserWhatsappConnection(userId),
    accessTokenSource: tokenStatus.source,
    channel: {
      phoneNumber: channelConfig.solutionPhoneNumber,
      phoneNumberId: channelConfig.phoneNumberId,
      businessAccountId: channelConfig.businessAccountId,
    },
    missingConfig,
  };
}

export async function updateWhatsappConnection(userId: number, input: WhatsappConnectionInput) {
  const channelConfig = getWhatsAppChannelConfig();
  const normalizedContactPhone = normalizeWhatsAppPhoneNumber(input.phoneNumber);
  if (channelConfig.solutionPhoneNumber && normalizedContactPhone === channelConfig.solutionPhoneNumber) {
    throw new OfficialWhatsappNumberError();
  }

  const connection = await upsertUserWhatsappConnection({
    userId,
    phoneNumber: input.phoneNumber,
    displayName: input.displayName,
  });

  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "whatsapp.connection_updated",
    detail: `Contato final ${connection.phoneNumber} vinculado ao usuário para processamento automático do WhatsApp.`,
  });

  return connection;
}

async function logAndReturnInterpretedIntent(
  userId: number,
  interpreted: {
    action: string;
    eventType: string;
    detail: string;
  } | null,
) {
  if (!interpreted) {
    return null;
  }

  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: getWhatsAppIntentLogStatus(interpreted.action),
    eventType: interpreted.eventType,
    detail: interpreted.detail,
  });
  return interpreted;
}

function buildMultimodalClarification(normalized: Awaited<ReturnType<typeof normalizeWhatsappMultimodalInput>>) {
  return {
    handled: true,
    action: "multimodal_clarification_needed",
    reply: normalized.clarificationQuestion ?? "Preciso de mais contexto para entender essa mídia com segurança.",
    eventType: "whatsapp.multimodal.clarification_needed",
    detail: normalized.historyDetail,
    data: {
      inputModality: normalized.inputModality,
      mediaKind: normalized.mediaContext?.mediaKind ?? null,
      extractionPerformed: normalized.extraction.performed,
      extractionConfidence: normalized.extraction.confidence,
    },
  };
}

export async function simulateWhatsappInbound(userId: number, input: SimulateWhatsappInboundInput) {
  const normalizedInput = await normalizeWhatsappMultimodalInput(input);
  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: normalizedInput.needsClarification ? "warning" : "success",
    eventType: "whatsapp.multimodal.normalized",
    detail: normalizedInput.historyDetail,
  });

  if (normalizedInput.needsClarification) {
    return buildMultimodalClarification(normalizedInput);
  }

  const text = normalizedInput.routerText ?? undefined;

  if (text) {
    const professionalAccessResponse = await processProfessionalAccessWhatsappResponse(userId, text);
    if (professionalAccessResponse) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: professionalAccessResponse.action === "professional_access_decision_ambiguous" ? "warning" : "success",
        eventType: professionalAccessResponse.eventType,
        detail: professionalAccessResponse.detail,
      });
      return professionalAccessResponse;
    }
  }

  const waterFoodSplit = splitWhatsAppWaterAndFoodText(text);
  if (waterFoodSplit) {
    const waterResults = [];
    for (const waterLine of waterFoodSplit.waterLines) {
      const interpretedWater = await executeWhatsappTextIntent(userId, {
        text: waterLine.text,
        receivedAt: new Date(),
      });
      if (!interpretedWater) {
        throw new Error(`Não foi possível registrar a hidratação informada em "${waterLine.text}".`);
      }

      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: getWhatsAppIntentLogStatus(interpretedWater.action),
        eventType: interpretedWater.eventType,
        detail: interpretedWater.detail,
      });
      waterResults.push(interpretedWater);
    }

    const meal = await processMealDraft(userId, {
      source: "whatsapp",
      text: waterFoodSplit.foodText,
    });

    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.water_and_food_multiline_detected",
      detail: "Mensagem multi-linha com hidratação e alimentos foi separada antes do processamento da refeição.",
    });

    return {
      handled: true,
      action: "water_and_meal_logged",
      reply: "Registrei a hidratação e encaminhei os alimentos para revisão da refeição.",
      eventType: "whatsapp.intent.water_and_food_multiline_detected",
      detail: "Hidratação e alimentos processados a partir de uma mensagem multi-linha.",
      data: {
        waterLogs: waterResults.map((result) => result.data),
        foodText: waterFoodSplit.foodText,
      },
      water: waterResults,
      meal,
    };
  }

  const waterCorrectionMatch = text ? /\b(?:n[aã]o)\s+(?:é|e|era)\s+(.+?)\s+(?:é|e|era)\s+(.+)$/i.exec(text) : null;
  if (waterCorrectionMatch) {
    const fromText = waterCorrectionMatch[1].trim();
    const toText = waterCorrectionMatch[2].trim();
    if (isWhatsAppWaterOnlyText(fromText) && toText) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.intent.food_correction_text_detected",
        detail: "Correção de texto detectada: hidratação foi substituída por alimento antes do processamento nutricional.",
      });
      return processMealDraft(userId, { source: "whatsapp", text: toText });
    }
  }

  const llmInterpreted = await logAndReturnInterpretedIntent(userId, await executeWhatsappLlmIntent(userId, {
    text,
    receivedAt: new Date(),
  }));
  if (llmInterpreted) {
    return llmInterpreted;
  }

  const interpreted = await logAndReturnInterpretedIntent(userId, await executeWhatsappTextIntent(userId, {
    text,
    receivedAt: new Date(),
  }));
  if (interpreted) {
    return interpreted;
  }

  const assistant = executeWhatsAppFoodAssistantIntent(text);
  if (assistant) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: assistant.eventType,
      detail: assistant.detail,
    });
    return assistant;
  }

  return processMealDraft(userId, { source: "whatsapp", text });
}
