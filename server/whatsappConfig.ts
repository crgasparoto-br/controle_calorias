import { getWhatsAppAccessToken } from "./db";

export type WhatsAppChannelConfig = {
  solutionPhoneNumber: string | null;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  verifyToken: string | null;
};

export type WhatsAppSendConfig = WhatsAppChannelConfig & {
  accessToken: string;
  phoneNumberId: string;
};

export function normalizeWhatsAppPhoneNumber(phoneNumber: string) {
  return phoneNumber.replace(/\D/g, "");
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getWhatsAppChannelConfig(): WhatsAppChannelConfig {
  const solutionPhoneNumber = envValue("WHATSAPP_PHONE_NUMBER");

  return {
    solutionPhoneNumber: solutionPhoneNumber ? normalizeWhatsAppPhoneNumber(solutionPhoneNumber) : null,
    phoneNumberId: envValue("WHATSAPP_PHONE_NUMBER_ID"),
    businessAccountId: envValue("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    verifyToken: envValue("WHATSAPP_VERIFY_TOKEN"),
  };
}

export function getMissingWhatsAppChannelConfig(config = getWhatsAppChannelConfig()) {
  return [
    ["WHATSAPP_PHONE_NUMBER", config.solutionPhoneNumber],
    ["WHATSAPP_PHONE_NUMBER_ID", config.phoneNumberId],
    ["WHATSAPP_VERIFY_TOKEN", config.verifyToken],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

export async function requireWhatsAppSendConfig(): Promise<WhatsAppSendConfig> {
  const channel = getWhatsAppChannelConfig();
  const accessToken = (await getWhatsAppAccessToken())?.trim() || null;
  const missing = [
    ...getMissingWhatsAppChannelConfig(channel).filter(name => name !== "WHATSAPP_VERIFY_TOKEN"),
    ...(accessToken ? [] : ["WHATSAPP_ACCESS_TOKEN"]),
  ];

  if (missing.length) {
    throw new Error(`Configuração obrigatória do WhatsApp ausente: ${missing.join(", ")}.`);
  }

  return {
    ...channel,
    accessToken: accessToken!,
    phoneNumberId: channel.phoneNumberId!,
  };
}

export async function requireWhatsAppMediaConfig() {
  const accessToken = (await getWhatsAppAccessToken())?.trim();
  if (!accessToken) {
    throw new Error("Configuração obrigatória do WhatsApp ausente: WHATSAPP_ACCESS_TOKEN.");
  }

  return { accessToken };
}
