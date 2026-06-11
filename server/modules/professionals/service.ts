import crypto from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { userPreferences, users, whatsappConnections } from "../../../drizzle/schema";
import { invokeLLM } from "../../_core/llm";
import { getDb, getDashboardSnapshot, getWeeklyProgress, getWeeklySummary, listUserMeals } from "../../db";
import { redactSensitiveText } from "../../privacy";
import { getNutritionGoal } from "../goals/service";
import {
  professionalPatientAnswerSchema,
  type ProfessionalCommentInput,
  type ProfessionalGoalSuggestionInput,
  type ProfessionalGoalSuggestionStatus,
  type ProfessionalMealSuggestionInput,
  type ProfessionalMealSuggestionStatus,
  type ProfessionalPatientAnswer,
  type ProfessionalPatientQuestionInput,
  type ProfessionalProfileInput,
  type RequestPatientAccessInput,
} from "./schemas";

type AccessStatus = "pending" | "approved" | "revoked" | "rejected";

type ProfessionalProfile = {
  userId: number;
  displayName: string;
  registrationNumber?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

type ProfessionalPatientAccess = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  status: AccessStatus;
  reason: string;
  requestedAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
};

type ProfessionalComment = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  comment: string;
  createdAt: number;
};

type GoalSuggestion = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  rationale: string;
  status: ProfessionalGoalSuggestionStatus;
  goal: ProfessionalGoalSuggestionInput["goal"];
  createdAt: number;
  sentAt: number | null;
  respondedAt: number | null;
};

type MealSuggestion = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  mealLabel: string;
  title: string;
  description: string;
  rationale: string;
  notes?: string;
  status: ProfessionalMealSuggestionStatus;
  createdAt: number;
  sentAt: number | null;
  respondedAt: number | null;
};

type HistoryEvent = {
  id: string;
  actorUserId: number;
  patientUserId: number;
  professionalUserId: number;
  eventType: "profile_upserted" | "access_requested" | "access_approved" | "access_revoked" | "comment_created" | "goal_suggested" | "meal_suggested" | "patient_question_answered";
  createdAt: number;
};

type UserSummary = {
  userId: number;
  name: string | null;
  email: string | null;
};

const PROFESSIONAL_AI_NOTICE = "Resposta educativa para apoiar a análise profissional. Não substitui julgamento clínico, diagnóstico, prescrição médica ou decisão compartilhada com a pessoa acompanhada.";
const PROFESSIONAL_PROFILE_PREFERENCE_KEY = "professional_profile_v1";
const PROFESSIONAL_ACCESSES_PREFERENCE_KEY = "professional_accesses_v1";
const PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY = "patient_professional_access_requests_v1";
const BRAZIL_COUNTRY_CODE = "55";

const profiles = new Map<number, ProfessionalProfile>();
const accesses = new Map<string, ProfessionalPatientAccess>();
const comments: ProfessionalComment[] = [];
const goalSuggestions: GoalSuggestion[] = [];
const mealSuggestions: MealSuggestion[] = [];
const history: HistoryEvent[] = [];

function pushHistory(event: Omit<HistoryEvent, "id" | "createdAt">) {
  history.push({ id: crypto.randomUUID(), createdAt: Date.now(), ...event });
}

function publicAccess(access: ProfessionalPatientAccess) {
  return {
    id: access.id,
    professionalUserId: access.professionalUserId,
    patientUserId: access.patientUserId,
    status: access.status,
    reason: access.reason,
    requestedAt: access.requestedAt,
    approvedAt: access.approvedAt,
    revokedAt: access.revokedAt,
  };
}

function normalizeContact(value: string) {
  return value.trim();
}

function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function buildPhoneLookupCandidates(value: string) {
  const trimmed = value.trim();
  const digits = normalizePhoneDigits(value);
  const candidates = new Set<string>();

  if (trimmed) candidates.add(trimmed);
  if (digits) {
    candidates.add(digits);
    candidates.add(`+${digits}`);

    if (digits.length === 10 || digits.length === 11) {
      const brazilianDigits = `${BRAZIL_COUNTRY_CODE}${digits}`;
      candidates.add(brazilianDigits);
      candidates.add(`+${brazilianDigits}`);
    }

    if (digits.startsWith(BRAZIL_COUNTRY_CODE) && digits.length > BRAZIL_COUNTRY_CODE.length) {
      const nationalDigits = digits.slice(BRAZIL_COUNTRY_CODE.length);
      candidates.add(nationalDigits);
      candidates.add(`+${nationalDigits}`);
    }
  }

  return Array.from(candidates).filter(Boolean);
}

function isEmailContact(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function responseTimestamp(status: ProfessionalGoalSuggestionStatus | ProfessionalMealSuggestionStatus, now: number) {
  return ["accepted", "refused", "cancelled"].includes(status) ? now : null;
}

function isAccessStatus(value: unknown): value is AccessStatus {
  return value === "pending" || value === "approved" || value === "revoked" || value === "rejected";
}

function normalizeStoredAccess(value: Partial<ProfessionalPatientAccess>): ProfessionalPatientAccess | null {
  if (
    typeof value.id !== "string" ||
    typeof value.professionalUserId !== "number" ||
    typeof value.patientUserId !== "number" ||
    !isAccessStatus(value.status) ||
    typeof value.reason !== "string" ||
    typeof value.requestedAt !== "number"
  ) {
    return null;
  }

  return {
    id: value.id,
    professionalUserId: value.professionalUserId,
    patientUserId: value.patientUserId,
    status: value.status,
    reason: value.reason,
    requestedAt: value.requestedAt,
    approvedAt: typeof value.approvedAt === "number" ? value.approvedAt : null,
    revokedAt: typeof value.revokedAt === "number" ? value.revokedAt : null,
  };
}

function parseStoredAccesses(userId: number, preferenceKey: string, value: string): ProfessionalPatientAccess[] {
  try {
    const parsed = JSON.parse(value) as Array<Partial<ProfessionalPatientAccess>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeStoredAccess)
      .filter((access): access is ProfessionalPatientAccess => Boolean(access))
      .filter(access => preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
        ? access.professionalUserId === userId
        : access.patientUserId === userId,
      );
  } catch {
    return [];
  }
}

function mergeAccesses(current: ProfessionalPatientAccess[], nextAccess: ProfessionalPatientAccess) {
  const next = current.filter(access => access.id !== nextAccess.id);
  next.push(nextAccess);
  return next.sort((a, b) => b.requestedAt - a.requestedAt);
}

async function loadPersistedAccesses(userId: number, preferenceKey: string) {
  const db = await getDb();
  if (!db) {
    return Array.from(accesses.values()).filter(access => preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
      ? access.professionalUserId === userId
      : access.patientUserId === userId,
    );
  }

  const rows = await db
    .select()
    .from(userPreferences)
    .where(and(eq(userPreferences.userId, userId), eq(userPreferences.preferenceKey, preferenceKey)))
    .limit(1);
  const loadedAccesses = rows[0]?.preferenceValue ? parseStoredAccesses(userId, preferenceKey, rows[0].preferenceValue) : [];
  loadedAccesses.forEach(access => accesses.set(access.id, access));
  return loadedAccesses;
}

async function persistAccessesForUser(userId: number, preferenceKey: string, nextAccesses: ProfessionalPatientAccess[]) {
  const db = await getDb();
  if (!db) return;

  await db.insert(userPreferences).values({
    userId,
    preferenceKey,
    preferenceValue: JSON.stringify(nextAccesses.map(publicAccess)),
  }).onDuplicateKeyUpdate({
    set: {
      preferenceValue: JSON.stringify(nextAccesses.map(publicAccess)),
    },
  });
}

async function persistAccessForBothSides(access: ProfessionalPatientAccess) {
  accesses.set(access.id, access);

  const [professionalAccesses, patientAccesses] = await Promise.all([
    loadPersistedAccesses(access.professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY),
    loadPersistedAccesses(access.patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY),
  ]);

  await Promise.all([
    persistAccessesForUser(access.professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY, mergeAccesses(professionalAccesses, access)),
    persistAccessesForUser(access.patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY, mergeAccesses(patientAccesses, access)),
  ]);
}

async function parseStoredProfessionalProfile(userId: number, value: string): Promise<ProfessionalProfile | null> {
  try {
    const parsed = JSON.parse(value) as Partial<ProfessionalProfile>;
    if (parsed.userId !== userId || typeof parsed.displayName !== "string" || typeof parsed.active !== "boolean") {
      return null;
    }

    return {
      userId,
      displayName: parsed.displayName,
      registrationNumber: typeof parsed.registrationNumber === "string" ? parsed.registrationNumber : undefined,
      active: parsed.active,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

async function persistProfessionalProfile(profile: ProfessionalProfile) {
  const db = await getDb();
  if (!db) return;

  await db.insert(userPreferences).values({
    userId: profile.userId,
    preferenceKey: PROFESSIONAL_PROFILE_PREFERENCE_KEY,
    preferenceValue: JSON.stringify(profile),
  }).onDuplicateKeyUpdate({
    set: {
      preferenceValue: JSON.stringify(profile),
    },
  });
}

async function loadPersistedProfessionalProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(userPreferences)
    .where(and(eq(userPreferences.userId, userId), eq(userPreferences.preferenceKey, PROFESSIONAL_PROFILE_PREFERENCE_KEY)))
    .limit(1);
  const profile = rows[0]?.preferenceValue ? await parseStoredProfessionalProfile(userId, rows[0].preferenceValue) : null;
  if (profile) profiles.set(userId, profile);
  return profile;
}

async function assertActiveProfessionalProfile(userId: number) {
  const profile = await getProfessionalProfile(userId);
  if (!profile?.active) {
    throw new Error("Ative seu perfil profissional em Configurações antes de acessar a área Profissional.");
  }
  return profile;
}

function parseAssistantContent(content: unknown) {
  const text = Array.isArray(content)
    ? content.map(part => ("text" in part ? part.text : "")).join("\n")
    : String(content ?? "");
  return JSON.parse(text);
}

export async function getProfessionalStatus(userId: number) {
  const profile = await getProfessionalProfile(userId);
  return {
    hasActiveProfile: Boolean(profile?.active),
    profile,
  };
}

async function getUserSummary(userId: number): Promise<UserSummary | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByEmail(email: string): Promise<UserSummary | null> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();
  if (!db) {
    if (process.env.NODE_ENV === "test") {
      const syntheticUserId = /^user-(\d+)@example\.com$/.exec(normalizedEmail)?.[1];
      if (syntheticUserId) {
        const userId = Number(syntheticUserId);
        return {
          userId,
          name: `User ${userId}`,
          email: normalizedEmail,
        };
      }
    }
    throw new Error("A busca por pessoa acompanhada via e-mail depende do banco configurado neste ambiente.");
  }

  const rows = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  const user = rows[0];
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByPhone(phone: string): Promise<UserSummary | null> {
  const db = await getDb();
  if (!db) {
    throw new Error("A busca por pessoa acompanhada via celular depende do banco configurado neste ambiente.");
  }

  const phoneCandidates = buildPhoneLookupCandidates(phone);
  const rows = await db
    .select({ user: users })
    .from(whatsappConnections)
    .innerJoin(users, eq(users.id, whatsappConnections.userId))
    .where(or(...phoneCandidates.map(candidate => eq(whatsappConnections.phoneNumber, candidate))))
    .limit(1);
  const user = rows[0]?.user;
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByContact(contact: string): Promise<UserSummary | null> {
  const normalizedContact = normalizeContact(contact);
  if (isEmailContact(normalizedContact)) {
    return getUserSummaryByEmail(normalizedContact);
  }
  return getUserSummaryByPhone(normalizedContact);
}

async function getApprovedAccess(professionalUserId: number, patientUserId: number) {
  const current = Array.from(accesses.values()).find(access =>
    access.professionalUserId === professionalUserId &&
    access.patientUserId === patientUserId &&
    access.status === "approved",
  );
  if (current) return current;

  const professionalAccesses = await loadPersistedAccesses(professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY);
  return professionalAccesses.find(access => access.patientUserId === patientUserId && access.status === "approved");
}

async function assertApprovedAccess(professionalUserId: number, patientUserId: number) {
  const access = await getApprovedAccess(professionalUserId, patientUserId);
  if (!access) {
    throw new Error("Acesso profissional não autorizado pela pessoa acompanhada.");
  }
  await assertActiveProfessionalProfile(professionalUserId);
  return access;
}

export async function upsertProfessionalProfile(userId: number, input: ProfessionalProfileInput) {
  const now = Date.now();
  const profile: ProfessionalProfile = {
    userId,
    displayName: input.displayName,
    registrationNumber: input.registrationNumber,
    active: input.active,
    createdAt: profiles.get(userId)?.createdAt ?? now,
    updatedAt: now,
  };
  profiles.set(userId, profile);
  await persistProfessionalProfile(profile);
  pushHistory({
    actorUserId: userId,
    professionalUserId: userId,
    patientUserId: userId,
    eventType: "profile_upserted",
  });
  return profile;
}

export async function getProfessionalProfile(userId: number) {
  return profiles.get(userId) ?? await loadPersistedProfessionalProfile(userId);
}

export async function requestPatientAccess(professionalUserId: number, input: RequestPatientAccessInput) {
  await assertActiveProfessionalProfile(professionalUserId);

  const patientContact = input.patientContact ?? input.patientEmail ?? "";
  const patient = await getUserSummaryByContact(patientContact);
  if (!patient) {
    throw new Error("Nenhuma pessoa foi encontrada com esse e-mail ou celular.");
  }
  if (professionalUserId === patient.userId) throw new Error("Profissional e pessoa acompanhada precisam ser usuários diferentes.");

  const professionalAccesses = await loadPersistedAccesses(professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY);
  const existing = professionalAccesses.find(access =>
    access.professionalUserId === professionalUserId &&
    access.patientUserId === patient.userId &&
    access.status !== "revoked",
  );
  if (existing) {
    return {
      ...publicAccess(existing),
      patient,
    };
  }

  const access: ProfessionalPatientAccess = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: patient.userId,
    status: "pending",
    reason: input.reason,
    requestedAt: Date.now(),
    approvedAt: null,
    revokedAt: null,
  };
  await persistAccessForBothSides(access);
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: patient.userId,
    eventType: "access_requested",
  });
  return {
    ...publicAccess(access),
    patient,
  };
}

export async function listProfessionalAccesses(professionalUserId: number) {
  await assertActiveProfessionalProfile(professionalUserId);
  const professionalAccesses = await loadPersistedAccesses(professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY);
  const patients = await Promise.all(professionalAccesses.map(access => getUserSummary(access.patientUserId)));
  const patientMap = new Map(
    patients
      .filter((patient): patient is UserSummary => Boolean(patient))
      .map(patient => [patient.userId, patient]),
  );

  return professionalAccesses.map(access => ({
    ...publicAccess(access),
    patient: patientMap.get(access.patientUserId) ?? null,
  }));
}

export async function listPatientAccessRequests(patientUserId: number) {
  const patientAccesses = await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY);
  const professionalProfiles = await Promise.all(patientAccesses.map(access => getProfessionalProfile(access.professionalUserId)));
  const professionalMap = new Map(
    professionalProfiles
      .filter((profile): profile is ProfessionalProfile => Boolean(profile))
      .map(profile => [profile.userId, profile]),
  );

  return patientAccesses.map(access => ({
    ...publicAccess(access),
    professional: professionalMap.get(access.professionalUserId) ?? null,
  }));
}

export async function approvePatientAccess(patientUserId: number, accessId: string) {
  const patientAccesses = await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY);
  const access = accesses.get(accessId) ?? patientAccesses.find(item => item.id === accessId);
  if (!access || access.patientUserId !== patientUserId) throw new Error("Solicitação de acesso não encontrada.");
  if (access.status !== "pending") throw new Error("Apenas solicitações pendentes podem ser aprovadas.");
  const approved = { ...access, status: "approved" as const, approvedAt: Date.now(), revokedAt: null };
  await persistAccessForBothSides(approved);
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_approved",
  });
  return publicAccess(approved);
}

export async function revokePatientAccess(patientUserId: number, accessId: string) {
  const patientAccesses = await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY);
  const access = accesses.get(accessId) ?? patientAccesses.find(item => item.id === accessId);
  if (!access || access.patientUserId !== patientUserId) throw new Error("Vínculo de acesso não encontrado.");
  const revoked = { ...access, status: "revoked" as const, revokedAt: Date.now() };
  await persistAccessForBothSides(revoked);
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_revoked",
  });
  return publicAccess(revoked);
}

export async function getProfessionalPatientDashboard(professionalUserId: number, patientUserId: number) {
  await assertApprovedAccess(professionalUserId, patientUserId);
  const [dashboard, weeklyProgress, weeklyReport, meals, patient, nutritionGoal] = await Promise.all([
    getDashboardSnapshot(patientUserId),
    getWeeklyProgress(patientUserId),
    getWeeklySummary(patientUserId),
    listUserMeals(patientUserId),
    getUserSummary(patientUserId),
    getNutritionGoal(patientUserId),
  ]);

  return {
    patientId: patientUserId,
    patient,
    weeklyAdherence: dashboard.week.adherence,
    calories: {
      consumed: dashboard.week.consumed.calories,
      planned: dashboard.week.planned.calories,
      burned: dashboard.week.burned.calories,
    },
    macros: {
      protein: dashboard.week.consumed.protein,
      carbs: dashboard.week.consumed.carbs,
      fat: dashboard.week.consumed.fat,
    },
    weight: weeklyProgress.weight,
    nutritionGoal,
    weeklyReport,
    meals: meals.slice(0, 20),
    comments: comments.filter(comment => comment.professionalUserId === professionalUserId && comment.patientUserId === patientUserId),
    goalSuggestions: goalSuggestions.filter(item => item.professionalUserId === professionalUserId && item.patientUserId === patientUserId),
    mealSuggestions: mealSuggestions.filter(item => item.professionalUserId === professionalUserId && item.patientUserId === patientUserId),
  };
}

type ProfessionalPatientDashboard = Awaited<ReturnType<typeof getProfessionalPatientDashboard>>;

function buildPatientQuestionContext(snapshot: ProfessionalPatientDashboard) {
  return {
    weeklyAdherence: snapshot.weeklyAdherence,
    calories: snapshot.calories,
    consumedMacros: snapshot.macros,
    currentGoal: snapshot.nutritionGoal.defaultGoal,
    goalExceptionsCount: snapshot.nutritionGoal.exceptions.length,
    weight: snapshot.weight,
    recentMeals: snapshot.meals.slice(0, 8).map(meal => ({
      mealLabel: meal.mealLabel,
      occurredAt: meal.occurredAt,
      calories: meal.totals.calories,
    })),
    suggestionCounts: {
      goals: snapshot.goalSuggestions.length,
      meals: snapshot.mealSuggestions.length,
      comments: snapshot.comments.length,
    },
  };
}

function buildFallbackPatientAnswer(question: string, snapshot: ProfessionalPatientDashboard): ProfessionalPatientAnswer & { generatedAt: number } {
  const context = buildPatientQuestionContext(snapshot);
  const consumed = Math.round(context.calories.consumed);
  const planned = Math.round(context.calories.planned);
  const adherence = Math.round(context.weeklyAdherence);

  return {
    answer: [
      `Com base nos dados autorizados, a semana mostra ${consumed} kcal consumidas de ${planned} kcal planejadas e aderência de ${adherence}%.`,
      "Use essa leitura como apoio para revisar registros recentes, metas e comentários antes de sugerir ajustes.",
      `Pergunta analisada: ${question}`,
    ].join(" "),
    citedContext: [
      `Aderência semanal: ${adherence}%`,
      `Calorias semanais: ${consumed}/${planned}`,
      `Refeições recentes consideradas: ${context.recentMeals.length}`,
    ],
    caution: "A resposta foi gerada em modo seguro de fallback, sem chamada ao provedor de IA.",
    educationalNotice: PROFESSIONAL_AI_NOTICE,
    generatedAt: Date.now(),
  };
}

export async function addProfessionalComment(professionalUserId: number, input: ProfessionalCommentInput) {
  await assertApprovedAccess(professionalUserId, input.patientId);
  const comment: ProfessionalComment = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    comment: input.comment,
    createdAt: Date.now(),
  };
  comments.push(comment);
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: input.patientId,
    eventType: "comment_created",
  });
  return comment;
}

export async function suggestGoalAdjustment(professionalUserId: number, input: ProfessionalGoalSuggestionInput) {
  await assertApprovedAccess(professionalUserId, input.patientId);
  const now = Date.now();
  const suggestion: GoalSuggestion = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    rationale: input.rationale,
    status: input.status,
    goal: input.goal,
    createdAt: now,
    sentAt: input.status === "sent" ? now : null,
    respondedAt: responseTimestamp(input.status, now),
  };
  goalSuggestions.push(suggestion);
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: input.patientId,
    eventType: "goal_suggested",
  });
  return suggestion;
}

export async function suggestMealPlan(professionalUserId: number, input: ProfessionalMealSuggestionInput) {
  await assertApprovedAccess(professionalUserId, input.patientId);
  const now = Date.now();
  const suggestion: MealSuggestion = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    mealLabel: input.mealLabel,
    title: input.title,
    description: input.description,
    rationale: input.rationale,
    notes: input.notes,
    status: input.status,
    createdAt: now,
    sentAt: input.status === "sent" ? now : null,
    respondedAt: responseTimestamp(input.status, now),
  };
  mealSuggestions.push(suggestion);
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: input.patientId,
    eventType: "meal_suggested",
  });
  return suggestion;
}

export async function answerProfessionalPatientQuestion(professionalUserId: number, input: ProfessionalPatientQuestionInput) {
  await assertApprovedAccess(professionalUserId, input.patientId);
  const snapshot = await getProfessionalPatientDashboard(professionalUserId, input.patientId);
  const sanitizedQuestion = redactSensitiveText(input.question);
  const context = buildPatientQuestionContext(snapshot);

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: [
            "Você é um assistente educativo para profissionais dentro de um app de controle alimentar.",
            "Responda somente com base no contexto autorizado da pessoa acompanhada fornecido.",
            "Não faça diagnóstico, prescrição médica, promessa de resultado ou decisão clínica final.",
            "Se a pergunta exigir dado ausente, diga claramente que o dado não está disponível no contexto.",
            "Use linguagem objetiva, profissional e cautelosa.",
            "Responda apenas JSON válido no schema solicitado.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            pergunta: sanitizedQuestion,
            contexto: context,
            avisoObrigatorio: PROFESSIONAL_AI_NOTICE,
          }),
        },
      ],
      outputSchema: {
        name: "professional_patient_answer",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            answer: { type: "string" },
            citedContext: {
              type: "array",
              items: { type: "string" },
            },
            caution: { type: "string" },
            educationalNotice: { type: "string" },
          },
          required: ["answer", "citedContext", "educationalNotice"],
        },
      },
    });

    const parsed = professionalPatientAnswerSchema.parse(parseAssistantContent(result.choices[0]?.message.content));
    pushHistory({
      actorUserId: professionalUserId,
      professionalUserId,
      patientUserId: input.patientId,
      eventType: "patient_question_answered",
    });
    return { ...parsed, generatedAt: Date.now() };
  } catch {
    const fallback = buildFallbackPatientAnswer(sanitizedQuestion, snapshot);
    pushHistory({
      actorUserId: professionalUserId,
      professionalUserId,
      patientUserId: input.patientId,
      eventType: "patient_question_answered",
    });
    return fallback;
  }
}

export async function listProfessionalHistory(userId: number) {
  await assertActiveProfessionalProfile(userId);
  return history.filter(event => event.professionalUserId === userId || event.patientUserId === userId);
}
