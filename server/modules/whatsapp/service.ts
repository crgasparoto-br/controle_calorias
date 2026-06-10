import {
  getAdminWhatsAppTokenStatus,
  getUserWhatsappConnection,
  logInferenceEvent,
  upsertUserWhatsappConnection,
} from "../../db";
import { processMealDraft } from "../meals/service";
import {
  getMissingWhatsAppChannelConfig,
  getWhatsAppChannelConfig,
  normalizeWhatsAppPhoneNumber,
} from "../../whatsappConfig";
import { SimulateWhatsappInboundInput, WhatsappConnectionInput } from "./schemas";
import { executeWhatsAppFoodAssistantIntent } from "./foodAssistant";
import { executeWhatsappTextIntent } from "./intentActions";
import { splitWhatsAppWaterAndFoodText } from "./waterFoodText";

export class OfficialWhatsappNumberError extends Error {
  constructor() {
    super("Informe o telefone de origem do usuário final, não o número oficial fixo da solução.");
    this.name = "OfficialWhatsappNumberError";
  }
}

function cleanCorrectedFoodText(value?: string) {
  return value
    ?.replace(/\b(?:ontem|hoje|agora|por favor|pfv)\b/gi, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^\b(?:o|a|os|as|do|da|de|dos|das)\b\s+/i, "")
    .trim() || null;
}

function extractFoodCorrectionTarget(text?: string | null) {
  const correctionMatch = text?.match(/\b(?:n[aã]o)\s+(?:é|e|era)\s+(.+?)\s+(?:é|e|era)\s+(.+)$/i);
  if (!correctionMatch) {
    return null;
  }

  const targetFood = cleanCorrectedFoodText(correctionMatch[2]);
  if (!targetFood || /\d/.test(targetFood)) {
    return null;
  }

  return targetFood;
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

export async function simulateWhatsappInbound(userId: number, input: SimulateWhatsappInboundInput) {
  const correctedFood = extractFoodCorrectionTarget(input.text);
  if (correctedFood) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.food_correction_text_detected",
      detail: "Correção textual de alimento detectada antes de interpretar intenção de água.",
    });
    return processMealDraft(userId, { source: "whatsapp", text: correctedFood });
  }

  const waterFoodSplit = splitWhatsAppWaterAndFoodText(input.text);
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
        status: interpretedWater.action === "clarification_needed" ? "warning" : "success",
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

  const interpreted = await executeWhatsappTextIntent(userId, {
    text: input.text,
    receivedAt: new Date(),
  });

  if (interpreted) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: interpreted.action === "clarification_needed" ? "warning" : "success",
      eventType: interpreted.eventType,
      detail: interpreted.detail,
    });
    return interpreted;
  }

  const assistant = executeWhatsAppFoodAssistantIntent(input.text);
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

  return processMealDraft(userId, { source: "whatsapp", text: input.text });
}
