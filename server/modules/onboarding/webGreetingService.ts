import { sql, type SQL } from "drizzle-orm";
import { getDb, getUserNutritionGoal, getUserWhatsappConnection, logInferenceEvent } from "../../db";
import { userProfiles, users } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendWhatsAppTextMessage } from "../whatsapp/webhookUtils";

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

// ─── Full welcome message (v2) ────────────────────────────────────────────────

const OBJECTIVE_LABEL: Record<string, string> = {
  emagrecer: "Perder peso",
  manter_peso: "Manter o peso",
  ganhar_massa: "Ganhar massa muscular",
  melhorar_habitos: "Melhorar os hábitos alimentares",
};

export function buildWelcomeMessage(
  name: string | null | undefined,
  calorieGoal: number,
  objective: string | null | undefined,
): string {
  const displayName = firstName(name);
  const goalLabel = Math.round(calorieGoal).toString();
  const objectiveLabel = (objective && OBJECTIVE_LABEL[objective]) ?? "Não informado";

  return [
    `Olá, ${displayName}! 👋`,
    "Seja bem-vindo(a) ao Controle de Calorias.",
    "",
    "Este número de WhatsApp será seu canal rápido para registrar alimentos, refeições, água, exercícios e ajustes do dia a dia.",
    "",
    "Você pode enviar mensagens simples, por exemplo:",
    "",
    '"Café da manhã: 1 pão francês com manteiga e café com leite"',
    '"Almoço: arroz, feijão, frango grelhado e salada"',
    '"Adicionar 500ml de água"',
    '"Trocar o frango por peixe no almoço"',
    '"Jantar de ontem: omelete com queijo"',
    "",
    "Sempre que possível, o sistema interpreta sua mensagem, calcula as calorias e macronutrientes e registra as informações automaticamente no seu perfil.",
    "",
    "Você também pode usar o sistema pela web para acompanhar tudo com mais detalhes:",
    "",
    "• resumo do dia;",
    "• refeições registradas;",
    "• metas de calorias e macronutrientes;",
    "• relatórios de evolução;",
    "• ajustes manuais quando alguma informação precisar ser corrigida.",
    "",
    "Sua meta inicial de calorias foi definida com base nas informações preenchidas no seu perfil, como peso, altura, idade, sexo, nível de atividade física e objetivo informado, como perder peso, manter o peso ou ganhar massa.",
    "",
    `Meta diária estimada: ${goalLabel} kcal`,
    `Objetivo informado: ${objectiveLabel}`,
    "",
    "Essa meta serve como ponto de partida para acompanhar sua evolução. Com os registros feitos pelo WhatsApp e pela plataforma web, você poderá comparar o consumo diário com a meta, revisar os alimentos registrados e fazer ajustes quando necessário.",
    "",
    "O WhatsApp é ideal para registrar rapidamente no momento em que você come.",
    "A plataforma web é ideal para revisar, ajustar e acompanhar sua evolução com mais clareza.",
    "",
    "Dica: quanto mais clara for a mensagem, melhor será o registro. Informe alimentos, quantidades, marcas quando houver e a refeição correspondente.",
    "",
    "Exemplo:",
    '"Almoço: 150g de arroz, 100g de feijão, 120g de frango grelhado e salada"',
    "",
    "Obrigado pelo cadastro!",
    "A partir de agora, você pode começar enviando sua primeira refeição por aqui. ✅",
  ].join("\n");
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

    const { name, objective, calorieGoal } = await fetchUserContext(userId);

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

    const message = buildWelcomeMessage(name, calorieGoal, objective);
    const sentAt = new Date();
    const result = await sendWhatsAppTextMessage(connection.phoneNumber, message);

    const audit: WelcomeAudit = result.ok
      ? {
          status: "sent",
          channel: "whatsapp",
          template: WELCOME_TEMPLATE_KEY,
          attemptedAt: sentAt.toISOString(),
          sentAt: sentAt.toISOString(),
          detail: "Mensagem de boas-vindas enviada após onboarding.",
        }
      : {
          status: "failed",
          reason: "send_failed",
          channel: "whatsapp",
          template: WELCOME_TEMPLATE_KEY,
          attemptedAt: sentAt.toISOString(),
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
