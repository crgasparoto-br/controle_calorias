import { sql, type SQL } from "drizzle-orm";
import { getDb, getUserWhatsappConnection, logInferenceEvent } from "../../db";
import { sendWhatsAppTextMessage } from "../whatsapp/webhookUtils";

const GREETING_PREFERENCE_KEY = "whatsapp_web_greeting_status";
const GREETING_TEMPLATE_KEY = "web_onboarding_greeting_v1";

type GreetingStatus = "sent" | "failed" | "skipped";

type GreetingAudit = {
  status: GreetingStatus;
  reason?: "no_phone" | "duplicate" | "send_failed";
  channel: "whatsapp";
  template: typeof GREETING_TEMPLATE_KEY;
  sentAt?: string;
  attemptedAt: string;
  detail?: string;
};

const memoryGreetingAudit = new Map<number, GreetingAudit>();

async function executeRaw<T = unknown>(query: SQL) {
  const db = await getDb();
  if (!db) return null;
  return db.execute(query) as Promise<T>;
}

function firstRow<T>(result: unknown): T | null {
  const rows = Array.isArray(result) ? result[0] : (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) && rows.length ? rows[0] as T : null;
}

async function getGreetingAudit(userId: number) {
  const result = await executeRaw(sql`
    select preferenceValue
    from userPreferences
    where userId = ${userId} and preferenceKey = ${GREETING_PREFERENCE_KEY}
    limit 1
  `);

  if (!result) return memoryGreetingAudit.get(userId) ?? null;
  const row = firstRow<{ preferenceValue?: string }>(result);
  if (!row?.preferenceValue) return null;

  try {
    return JSON.parse(row.preferenceValue) as GreetingAudit;
  } catch {
    return null;
  }
}

async function persistGreetingAudit(userId: number, audit: GreetingAudit) {
  memoryGreetingAudit.set(userId, audit);
  const now = new Date();
  const payload = JSON.stringify(audit);

  await executeRaw(sql`
    insert into userPreferences (userId, preferenceKey, preferenceValue, createdAt, updatedAt)
    values (${userId}, ${GREETING_PREFERENCE_KEY}, ${payload}, ${now}, ${now})
    on duplicate key update preferenceValue = ${payload}, updatedAt = ${now}
  `);
}

function firstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] || "tudo bem";
}

function buildGreetingMessage(name: string | null | undefined) {
  return `Olá, ${firstName(name)}! Obrigado por se cadastrar no Controle de Calorias. Salve este número para registrar suas refeições, água e exercícios pelo WhatsApp sempre que precisar.`;
}

export async function sendWebOnboardingWhatsappGreeting(userId: number, input: {
  acceptedOperationalWhatsapp: boolean;
  userName?: string | null;
}) {
  if (!input.acceptedOperationalWhatsapp) {
    throw new Error("WHATSAPP_GREETING_CONSENT_REQUIRED");
  }

  const existing = await getGreetingAudit(userId);
  if (existing?.status === "sent") {
    return {
      status: "skipped" as const,
      reason: "duplicate" as const,
      detail: "Saudação já enviada anteriormente.",
    };
  }

  const connection = await getUserWhatsappConnection(userId);
  if (!connection?.phoneNumber || connection.status === "disabled") {
    const audit: GreetingAudit = {
      status: "skipped",
      reason: "no_phone",
      channel: "whatsapp",
      template: GREETING_TEMPLATE_KEY,
      attemptedAt: new Date().toISOString(),
      detail: "Usuário sem telefone WhatsApp válido vinculado.",
    };
    await persistGreetingAudit(userId, audit);
    return {
      status: "skipped" as const,
      reason: "no_phone" as const,
      detail: audit.detail,
    };
  }

  const sentAt = new Date();
  const result = await sendWhatsAppTextMessage(connection.phoneNumber, buildGreetingMessage(input.userName ?? connection.displayName));
  const audit: GreetingAudit = result.ok
    ? {
        status: "sent",
        channel: "whatsapp",
        template: GREETING_TEMPLATE_KEY,
        attemptedAt: sentAt.toISOString(),
        sentAt: sentAt.toISOString(),
        detail: "Saudação inicial enviada após onboarding web.",
      }
    : {
        status: "failed",
        reason: "send_failed",
        channel: "whatsapp",
        template: GREETING_TEMPLATE_KEY,
        attemptedAt: sentAt.toISOString(),
        detail: result.detail.slice(0, 500),
      };

  await persistGreetingAudit(userId, audit);
  logInferenceEvent({
    userId,
    origin: "web",
    status: result.ok ? "success" : "warning",
    eventType: result.ok ? "whatsapp.web_greeting_sent" : "whatsapp.web_greeting_failed",
    detail: audit.detail ?? "Tentativa de saudação WhatsApp registrada.",
  });

  return result.ok
    ? { status: "sent" as const, detail: audit.detail }
    : { status: "failed" as const, reason: "send_failed" as const, detail: audit.detail };
}
