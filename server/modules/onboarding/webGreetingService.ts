import { sql, type SQL } from "drizzle-orm";
import { getDb, getUserNutritionGoal, getUserWhatsappConnection, logInferenceEvent } from "../../db";
import { userProfiles, users } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { sequencedTextReply, textReply } from "../whatsapp/replyContract";
import { sendWhatsAppLogicalReply } from "../whatsapp/replyTransport";

const LEGACY_GREETING_PREFERENCE_KEY = "whatsapp_web_greeting_status";
const WELCOME_PREFERENCE_KEY = "whatsapp_welcome_v2_status";
const WELCOME_TEMPLATE_KEY = "web_onboarding_welcome_v2";

type WelcomeStatus = "sent" | "failed" | "skipped";

type WelcomeAudit = {
  status: WelcomeStatus;
  reason?: "no_phone" | "duplicate" | "send_failed" | "no_goal";
  channel: "whatsapp";
  template: typeof WELCOME_TEMPLATE_KEY;
  sentAt?: string;
  attemptedAt: string;
  detail?: string;
  deliveredMessageCount?: number;
};

const memoryWelcomeAudit = new Map<number, WelcomeAudit>();

// Kept for the legacy manual greeting endpoint (auth.sendWhatsappGreeting)
const GREETING_PREFERENCE_KEY = LEGACY_GREETING_PREFERENCE_KEY;
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
  acceptedOperationalWhatsapp?: boolean;
  userName?: string | null;
}) {
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
  const delivery = await sendWhatsAppLogicalReply(
    connection.phoneNumber,
    textReply(buildGreetingMessage(input.userName ?? connection.displayName)),
  );
  const result = {
    ok: delivery.primaryOk,
    detail: delivery.sends.find(send => !send.ok)?.detail ?? "Saudação enviada.",
  };
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

// ─── Full welcome message (v2) ────────────────────────────────────────────────

export function buildWelcomeMessages(): [string, string] {
  return [
    [
      "👋 *Bem-vindo ao Controle de Calorias!*",
      "",
      "Você pode usar o WhatsApp para:",
      "",
      "• Registrar refeições por texto, foto ou áudio",
      "• Registrar água e peso",
      "• Consultar consumo, metas e refeições",
      "• Corrigir ou excluir registros",
      "",
      "*Exemplos*",
      "• Comi arroz, feijão e frango no almoço",
      "• Bebi 500 ml de água",
      "• Meu peso hoje é 66,3 kg",
      "• Mostre meu resumo de hoje",
      "",
      "🤖 *Perguntas para a IA*",
      "",
      "Para fazer perguntas à IA, coloque `/` antes da pergunta.",
      "",
      "Exemplos:",
      "• /Quais alimentos têm mais proteína?",
      "• /O que posso comer para completar minha meta de carboidratos?",
      "• /Qual a diferença entre gordura saturada e insaturada?",
      "",
      "Sem a `/`, a mensagem será interpretada como uma solicitação de registro, consulta ou alteração no sistema.",
      "",
      "Você também pode acessar o sistema pela web para acompanhar relatórios, metas e configurações.",
    ].join("\n"),
    [
      "🎯 *Sua meta nutricional*",
      "",
      "Sua meta foi calculada com base nos dados informados no seu perfil.",
      "",
      "Ela pode ou não considerar as calorias dos exercícios, conforme a configuração escolhida no sistema.",
    ].join("\n"),
  ];
}

export function buildWelcomeMessage(
  _name: string | null | undefined,
  _calorieGoal: number,
  _objective: string | null | undefined,
): string {
  return buildWelcomeMessages().join("\n\n");
}

async function getWelcomeAudit(userId: number): Promise<WelcomeAudit | null> {
  const result = await executeRaw(sql`
    select preferenceValue
    from userPreferences
    where userId = ${userId} and preferenceKey = ${WELCOME_PREFERENCE_KEY}
    limit 1
  `);

  if (!result) return memoryWelcomeAudit.get(userId) ?? null;
  const row = firstRow<{ preferenceValue?: string }>(result);
  if (!row?.preferenceValue) return null;

  try {
    return JSON.parse(row.preferenceValue) as WelcomeAudit;
  } catch {
    return null;
  }
}

async function persistWelcomeAudit(userId: number, audit: WelcomeAudit) {
  memoryWelcomeAudit.set(userId, audit);
  const now = new Date();
  const payload = JSON.stringify(audit);

  await executeRaw(sql`
    insert into userPreferences (userId, preferenceKey, preferenceValue, createdAt, updatedAt)
    values (${userId}, ${WELCOME_PREFERENCE_KEY}, ${payload}, ${now}, ${now})
    on duplicate key update preferenceValue = ${payload}, updatedAt = ${now}
  `);
}

async function fetchUserContext(userId: number) {
  const db = await getDb();

  let name: string | null = null;
  let objective: string | null = null;

  if (db) {
    const profileRows = await db
      .select({ displayName: userProfiles.displayName, nutritionObjective: userProfiles.nutritionObjective })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const userRows = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    name = profileRows[0]?.displayName ?? userRows[0]?.name ?? null;
    objective = profileRows[0]?.nutritionObjective ?? null;
  }

  const goalSummary = await getUserNutritionGoal(userId);
  const calorieGoal = goalSummary?.defaultGoal?.calories ?? null;

  return { name, objective, calorieGoal };
}

export async function sendOnboardingWelcomeWhatsapp(userId: number): Promise<void> {
  try {
    const existing = await getWelcomeAudit(userId);
    if (existing?.status === "sent") {
      return;
    }

    const connection = await getUserWhatsappConnection(userId);
    if (!connection?.phoneNumber || connection.status === "disabled") {
      const audit: WelcomeAudit = {
        status: "skipped",
        reason: "no_phone",
        channel: "whatsapp",
        template: WELCOME_TEMPLATE_KEY,
        attemptedAt: new Date().toISOString(),
        detail: "Usuário sem telefone WhatsApp válido vinculado.",
      };
      await persistWelcomeAudit(userId, audit);
      logInferenceEvent({
        userId,
        origin: "web",
        status: "warning",
        eventType: "whatsapp.welcome_skipped_no_phone",
        detail: audit.detail ?? "",
      });
      return;
    }

    const { calorieGoal } = await fetchUserContext(userId);

    if (!calorieGoal || calorieGoal <= 0) {
      const audit: WelcomeAudit = {
        status: "skipped",
        reason: "no_goal",
        channel: "whatsapp",
        template: WELCOME_TEMPLATE_KEY,
        attemptedAt: new Date().toISOString(),
        detail: "Meta calórica ainda não disponível.",
      };
      await persistWelcomeAudit(userId, audit);
      logInferenceEvent({
        userId,
        origin: "web",
        status: "warning",
        eventType: "whatsapp.welcome_skipped_no_goal",
        detail: audit.detail ?? "",
      });
      return;
    }

    const messages = buildWelcomeMessages();
    const deliveredBefore = Math.min(Math.max(existing?.deliveredMessageCount ?? 0, 0), messages.length);
    const remainingMessages = messages.slice(deliveredBefore);
    if (!remainingMessages.length) {
      return;
    }

    const sentAt = new Date();
    const delivery = await sendWhatsAppLogicalReply(connection.phoneNumber, sequencedTextReply(remainingMessages));
    const deliveredNow = delivery.sends.findIndex(send => !send.ok) === -1
      ? delivery.sends.length
      : delivery.sends.findIndex(send => !send.ok);
    const deliveredMessageCount = Math.min(deliveredBefore + deliveredNow, messages.length);
    const result = {
      ok: deliveredMessageCount === messages.length,
      detail: delivery.sends.find(send => !send.ok)?.detail ?? "Onboarding enviado.",
    };

    const audit: WelcomeAudit = result.ok
      ? {
          status: "sent",
          channel: "whatsapp",
          template: WELCOME_TEMPLATE_KEY,
          attemptedAt: sentAt.toISOString(),
          sentAt: sentAt.toISOString(),
          deliveredMessageCount,
          detail: "Mensagem de boas-vindas enviada após onboarding.",
        }
      : {
          status: "failed",
          reason: "send_failed",
          channel: "whatsapp",
          template: WELCOME_TEMPLATE_KEY,
          attemptedAt: sentAt.toISOString(),
          deliveredMessageCount,
          detail: result.detail.slice(0, 500),
        };

    await persistWelcomeAudit(userId, audit);
    logInferenceEvent({
      userId,
      origin: "web",
      status: result.ok ? "success" : "warning",
      eventType: result.ok ? "whatsapp.welcome_sent" : "whatsapp.welcome_failed",
      detail: audit.detail ?? "Tentativa de mensagem de boas-vindas registrada.",
    });
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "web",
      status: "error",
      eventType: "whatsapp.welcome_error",
      detail: `Erro inesperado ao enviar boas-vindas WhatsApp: ${error instanceof Error ? error.message : "unknown"}`,
    });
  }
}
