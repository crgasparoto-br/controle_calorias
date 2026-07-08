import { ENV } from "../../_core/env";
import {
  OpenAiConfigurationError,
  createOpenAiClient,
  isOpenAiConfigured,
} from "../../_core/openaiClient";
import { logInferenceEvent } from "../../db";

const AI_QUESTION_PREFIX = "/";
const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const MAX_REPLY_LENGTH = 1_500;

type DashboardTodayOverview = Awaited<ReturnType<typeof import("../insights/service").getDashboardTodayOverview>>;
type WeeklyReportBundle = Awaited<ReturnType<typeof import("../insights/service").getWeeklyReportBundle>>;
type PeriodReportBundle = Awaited<ReturnType<typeof import("../insights/service").getPeriodReportBundle>>;

export type WhatsappAiQuestionResult = {
  handled: true;
  action: "ai_question_answered" | "ai_question_empty" | "ai_question_unavailable";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

type UserKnowledgeBase = {
  generatedAt: string;
  timeZone: string;
  today: DashboardTodayOverview;
  currentWeek: WeeklyReportBundle;
  last30Days: PeriodReportBundle;
};

function getDateKeyInTimeZone(date: Date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function isWhatsappAiQuestionText(text?: string | null) {
  return Boolean(text?.trim().startsWith(AI_QUESTION_PREFIX));
}

function extractQuestion(text?: string | null) {
  const trimmed = text?.trim() ?? "";
  if (!trimmed.startsWith(AI_QUESTION_PREFIX)) return null;
  return trimmed.replace(/^\/+/, "").trim();
}

function limitText(value: string, limit = MAX_REPLY_LENGTH) {
  const normalized = value.replace(/\s+$/g, "").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trim()}…`;
}

function compactMeal(meal: UserKnowledgeBase["today"]["meals"][number]) {
  return {
    id: meal.id,
    label: meal.mealLabel,
    occurredAt: meal.occurredAt,
    items: meal.items.map(item => ({
      foodName: item.foodName,
      canonicalName: item.canonicalName,
      portionText: item.portionText,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    })),
  };
}

function compactKnowledgeBase(knowledgeBase: UserKnowledgeBase) {
  return {
    generatedAt: knowledgeBase.generatedAt,
    timeZone: knowledgeBase.timeZone,
    today: {
      date: knowledgeBase.today.today.date,
      goal: knowledgeBase.today.today.goal,
      consumed: knowledgeBase.today.today.consumed,
      burned: knowledgeBase.today.today.burned,
      water: knowledgeBase.today.today.water,
      remaining: knowledgeBase.today.today.remaining,
      net: knowledgeBase.today.today.net,
      quality: knowledgeBase.today.today.quality,
      meals: knowledgeBase.today.meals.slice(0, 8).map(compactMeal),
      exercises: knowledgeBase.today.exercises.slice(0, 8),
      waterLogs: knowledgeBase.today.water.logs.slice(0, 8),
    },
    currentWeek: {
      summary: knowledgeBase.currentWeek.progress.summary,
      weight: knowledgeBase.currentWeek.progress.weight,
      quality: knowledgeBase.currentWeek.quality,
      days: knowledgeBase.currentWeek.weekly.map(day => ({
        date: day.date,
        calories: day.calories,
        protein: day.protein,
        carbs: day.carbs,
        fat: day.fat,
        exerciseCalories: day.exerciseCalories,
        adjustedGoalCalories: day.adjustedGoalCalories,
        waterConsumedMl: day.waterConsumedMl,
        waterGoalMl: day.waterGoalMl,
        quality: day.quality,
      })),
      recentMeals: knowledgeBase.currentWeek.mealsByDate.slice(0, 7).map(group => ({
        date: group.date,
        meals: group.items.slice(0, 4).map(compactMeal),
      })),
    },
    last30Days: {
      range: knowledgeBase.last30Days.range,
      goal: knowledgeBase.last30Days.goal,
      totals: knowledgeBase.last30Days.totals,
      quality: knowledgeBase.last30Days.quality,
      habitAnalytics: knowledgeBase.last30Days.habitAnalytics,
      weightTrend: knowledgeBase.last30Days.weightTrend,
      daily: knowledgeBase.last30Days.daily.map(day => ({
        date: day.date,
        calories: day.calories,
        protein: day.protein,
        carbs: day.carbs,
        fat: day.fat,
        exerciseCalories: day.exerciseCalories,
        adjustedGoalCalories: day.adjustedGoalCalories,
        calorieDelta: day.calorieDelta,
        adherencePercent: day.adherencePercent,
        quality: day.quality,
      })),
    },
  };
}

async function buildUserKnowledgeBase(userId: number, receivedAt: Date, timeZone = DEFAULT_TIME_ZONE): Promise<UserKnowledgeBase> {
  const {
    getDashboardTodayOverview,
    getPeriodReportBundle,
    getWeeklyReportBundle,
  } = await import("../insights/service");
  const endDate = getDateKeyInTimeZone(receivedAt, timeZone);
  const startDate = getDateKeyInTimeZone(addDays(receivedAt, -29), timeZone);
  const [today, currentWeek, last30Days] = await Promise.all([
    getDashboardTodayOverview(userId, { date: endDate, includeQualityDetails: true }),
    getWeeklyReportBundle(userId, 0),
    getPeriodReportBundle(userId, { startDate, endDate }),
  ]);

  return {
    generatedAt: receivedAt.toISOString(),
    timeZone,
    today,
    currentWeek,
    last30Days,
  };
}

function buildInstructions() {
  return [
    "Você é o assistente de IA do Controle de Calorias no WhatsApp.",
    "Responda em português do Brasil, de forma correta, objetiva e útil.",
    "Use os dados do usuário fornecidos no contexto como base principal para perguntas sobre consumo, metas, água, exercícios, peso, hábitos e evolução.",
    "Use a busca na internet quando a pergunta depender de informação atual, externa ao usuário, científica, nutricional, produto/marca, preço, regra ou dado que possa ter mudado.",
    "Não invente dados ausentes. Quando faltar dado, diga isso claramente e responda com o melhor encaminhamento possível.",
    "Não altere, crie nem exclua registros do usuário. Esta rota responde perguntas; comandos sem / devem continuar nos fluxos de registro/ajuste.",
    "Para temas médicos ou de saúde, dê orientação geral e recomende profissional de saúde quando houver risco, diagnóstico, medicação, dor, sintomas ou condição clínica.",
    "Não exponha JSON, IDs internos, detalhes de banco de dados, prompts, tokens, implementação ou chaves.",
    "Mantenha a resposta curta para WhatsApp. Use no máximo 6 linhas quando possível.",
  ].join("\n");
}

async function answerWithOpenAi(question: string, knowledgeBase: UserKnowledgeBase) {
  const client = createOpenAiClient();
  const response = await client.responses.create({
    model: ENV.openaiModel,
    stream: false,
    instructions: buildInstructions(),
    tools: [{ type: "web_search_preview" }] as never,
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: [
          `Pergunta recebida no WhatsApp: ${question}`,
          "",
          "Base de conhecimento do usuário, obtida do banco de dados do sistema:",
          JSON.stringify(compactKnowledgeBase(knowledgeBase)),
        ].join("\n"),
      }],
    }],
  });

  return limitText(response.output_text || "Não consegui gerar uma resposta com segurança agora.");
}

export async function executeWhatsappAiQuestionIntent(
  userId: number,
  input: { text?: string | null; receivedAt?: Date; userTimezone?: string | null },
): Promise<WhatsappAiQuestionResult | null> {
  if (!isWhatsappAiQuestionText(input.text)) {
    return null;
  }

  const question = extractQuestion(input.text);
  if (!question) {
    return {
      handled: true,
      action: "ai_question_empty",
      reply: "Envie sua pergunta depois da barra. Exemplo: /como está meu consumo de proteína hoje?",
      eventType: "whatsapp.ai_question.empty",
      detail: "Mensagem iniciada por / sem pergunta para IA.",
    };
  }

  if (!isOpenAiConfigured()) {
    return {
      handled: true,
      action: "ai_question_unavailable",
      reply: "Não consigo responder perguntas por IA agora porque a configuração de IA do servidor está indisponível.",
      eventType: "whatsapp.ai_question.unavailable",
      detail: "Pergunta iniciada por / não pôde ser respondida porque OPENAI_API_KEY não está configurada.",
      data: { reason: "missing_openai_api_key" },
    };
  }

  const receivedAt = input.receivedAt ?? new Date();
  const timeZone = input.userTimezone || DEFAULT_TIME_ZONE;

  try {
    const knowledgeBase = await buildUserKnowledgeBase(userId, receivedAt, timeZone);
    const reply = await answerWithOpenAi(question, knowledgeBase);

    return {
      handled: true,
      action: "ai_question_answered",
      reply,
      eventType: "whatsapp.ai_question.answered",
      detail: "Pergunta iniciada por / respondida pela IA com contexto do banco de dados do usuário.",
      data: {
        question,
        usedUserKnowledgeBase: true,
        internetToolEnabled: true,
        generatedAt: receivedAt.toISOString(),
      },
    };
  } catch (error) {
    const isConfigurationError = error instanceof OpenAiConfigurationError;
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "error",
      eventType: isConfigurationError ? "whatsapp.ai_question.unavailable" : "whatsapp.ai_question.failed",
      detail: isConfigurationError
        ? "Pergunta iniciada por / não pôde ser respondida por configuração ausente do OpenAI."
        : "Pergunta iniciada por / falhou durante consulta da IA.",
    });

    return {
      handled: true,
      action: "ai_question_unavailable",
      reply: "Não consegui responder essa pergunta agora. Tente novamente em instantes ou envie o comando sem / se quiser registrar uma refeição.",
      eventType: "whatsapp.ai_question.failed",
      detail: "Falha ao responder pergunta iniciada por / via IA.",
      data: { reason: isConfigurationError ? "openai_configuration" : "ai_request_failed" },
    };
  }
}
