import crypto from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { userPreferences, users, whatsappConnections } from "../../../drizzle/schema";
import { invokeLLM } from "../../_core/llm";
import { getDb, getUserWhatsappConnection, listUserMeals, logInferenceEvent } from "../../db";
import { getPeriodReportBundle, getWeeklyReportBundle } from "../insights/service";
import { redactSensitiveText } from "../../privacy";
import { getNutritionGoal } from "../goals/service";
import { sendWhatsAppTextMessage } from "../whatsapp/webhookUtils";
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
type AccessResponseOrigin = "web" | "whatsapp";
type AccessResponseDecision = "approved" | "rejected" | "revoked";
type AuthorizationMessageStatus = "sent" | "failed" | "skipped";

type ProfessionalProfile = {
  userId: number;
  displayName: string;
  registrationNumber?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ProfessionalPatientAccess = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  status: AccessStatus;
  reason: string;
  requestedAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
  rejectedAt: number | null;
  respondedAt: number | null;
  responseOrigin: AccessResponseOrigin | null;
  responseDecision: AccessResponseDecision | null;
  authorizationMessageStatus: AuthorizationMessageStatus | null;
  authorizationMessageSentAt: number | null;
  authorizationMessageError: string | null;
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
  eventType:
    | "profile_upserted"
    | "access_requested"
    | "access_approved"
    | "access_rejected"
    | "access_revoked"
    | "access_authorization_whatsapp_sent"
    | "access_authorization_whatsapp_failed"
    | "comment_created"
    | "goal_suggested"
    | "meal_suggested"
    | "patient_question_answered";
  createdAt: number;
};

type UserSummary = {
  userId: number;
  name: string | null;
  email: string | null;
};

type AuthorizationSendResult = {
  status: AuthorizationMessageStatus;
  detail: string;
  access: ProfessionalPatientAccess;
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

export function _forTestOnly_setAccessInMap(access: ProfessionalPatientAccess) {
  accesses.set(access.id, access);
}

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
    rejectedAt: access.rejectedAt,
    respondedAt: access.respondedAt,
    responseOrigin: access.responseOrigin,
    responseDecision: access.responseDecision,
    authorizationMessageStatus: access.authorizationMessageStatus,
    authorizationMessageSentAt: access.authorizationMessageSentAt,
    authorizationMessageError: access.authorizationMessageError,
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

function isAccessResponseOrigin(value: unknown): value is AccessResponseOrigin {
  return value === "web" || value === "whatsapp";
}

function isAccessResponseDecision(value: unknown): value is AccessResponseDecision {
  return value === "approved" || value === "rejected" || value === "revoked";
}

function isAuthorizationMessageStatus(value: unknown): value is AuthorizationMessageStatus {
  return value === "sent" || value === "failed" || value === "skipped";
}

function firstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] || "Profissional";
}

export function buildProfessionalAccessDecisionCode(accessId: string) {
  return accessId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
}

export function buildProfessionalAccessAuthorizationMessage(input: {
  professionalDisplayName: string;
  reason: string;
  accessId: string;
}) {
  const code = buildProfessionalAccessDecisionCode(input.accessId);
  return [
    `${input.professionalDisplayName} solicitou autorização para acompanhar seus registros no Controle de Calorias.`,
    `Motivo: ${input.reason}`,
    "",
    "Para responder pelo WhatsApp, envie uma das opções abaixo:",
    `AUTORIZAR ${code}`,
    `NEGAR ${code}`,
    "",
    "Ao autorizar, você permite que o profissional veja seus dados de acompanhamento. Você pode revogar esse vínculo depois pela plataforma.",
  ].join("\n");
}

function normalizeDecisionText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function parseProfessionalAccessWhatsappDecision(text: string): "approved" | "rejected" | null {
  const normalized = normalizeDecisionText(text);
  if (!normalized) return null;

  if (/\b(negar|nego|negado|recusar|recuso|recusado|rejeitar|rejeito|nao|não)\b/.test(normalized)) {
    return "rejected";
  }
  if (/\b(autorizar|autorizo|autorizado|aprovar|aprovo|aprovado|aceitar|aceito|sim)\b/.test(normalized)) {
    return "approved";
  }
  return null;
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
    rejectedAt: typeof value.rejectedAt === "number" ? value.rejectedAt : null,
    respondedAt: typeof value.respondedAt === "number" ? value.respondedAt : null,
    responseOrigin: isAccessResponseOrigin(value.responseOrigin) ? value.responseOrigin : null,
    responseDecision: isAccessResponseDecision(value.responseDecision) ? value.responseDecision : null,
    authorizationMessageStatus: isAuthorizationMessageStatus(value.authorizationMessageStatus) ? value.authorizationMessageStatus : null,
    authorizationMessageSentAt: typeof value.authorizationMessageSentAt === "number" ? value.authorizationMessageSentAt : null,
    authorizationMessageError: typeof value.authorizationMessageError === "string" ? value.authorizationMessageError : null,
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

async function loadProfessionalAccessesForPatient(patientUserId: number): Promise<ProfessionalPatientAccess[]> {
  const db = await getDb();
  if (!db) {
    return Array.from(accesses.values()).filter(a => a.patientUserId === patientUserId);
  }

  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.preferenceKey, PROFESSIONAL_ACCESSES_PREFERENCE_KEY));

  const found: ProfessionalPatientAccess[] = [];
  for (const row of rows) {
    if (!row.preferenceValue) continue;
    const parsed = parseStoredAccesses(row.userId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY, row.preferenceValue);
    found.push(...parsed.filter(a => a.patientUserId === patientUserId));
  }
  return found;
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

async function sendProfessionalAccessAuthorizationWhatsapp(
  access: ProfessionalPatientAccess,
  professionalProfile: ProfessionalProfile,
): Promise<AuthorizationSendResult> {
  const connection = await getUserWhatsappConnection(access.patientUserId);
  const attemptedAt = Date.now();

  if (!connection?.phoneNumber || connection.status === "disabled") {
    const detail = "Pessoa acompanhada sem WhatsApp ativo vinculado para receber a autorização.";
    const skipped: ProfessionalPatientAccess = {
      ...access,
      authorizationMessageStatus: "skipped",
      authorizationMessageSentAt: null,
      authorizationMessageError: detail,
    };
    await persistAccessForBothSides(skipped);
    logInferenceEvent({
      userId: access.professionalUserId,
      origin: "web",
      status: "warning",
      eventType: "professional.access.authorization_whatsapp_skipped",
      detail,
    });
    return { status: "skipped", detail, access: skipped };
  }

  const message = buildProfessionalAccessAuthorizationMessage({
    professionalDisplayName: professionalProfile.displayName,
    reason: access.reason,
    accessId: access.id,
  });
  const result = await sendWhatsAppTextMessage(connection.phoneNumber, message);
  const sent: ProfessionalPatientAccess = result.ok
    ? {
        ...access,
        authorizationMessageStatus: "sent",
        authorizationMessageSentAt: attemptedAt,
        authorizationMessageError: null,
      }
    : {
        ...access,
        authorizationMessageStatus: "failed",
        authorizationMessageSentAt: null,
        authorizationMessageError: result.detail.slice(0, 500),
      };

  await persistAccessForBothSides(sent);
  pushHistory({
    actorUserId: access.professionalUserId,
    professionalUserId: access.professionalUserId,
    patientUserId: access.patientUserId,
    eventType: result.ok ? "access_authorization_whatsapp_sent" : "access_authorization_whatsapp_failed",
  });
  logInferenceEvent({
    userId: access.professionalUserId,
    origin: "web",
    status: result.ok ? "success" : "warning",
    eventType: result.ok ? "professional.access.authorization_whatsapp_sent" : "professional.access.authorization_whatsapp_failed",
    detail: result.ok
      ? `Autorização profissional enviada ao WhatsApp da pessoa acompanhada #${access.patientUserId}.`
      : result.detail.slice(0, 500),
  });

  return {
    status: result.ok ? "sent" : "failed",
    detail: result.ok ? "Mensagem de autorização enviada pelo WhatsApp." : result.detail,
    access: sent,
  };
}

function buildDecisionReply(decision: "approved" | "rejected", professionalProfile: ProfessionalProfile | null) {
  const professionalName = firstName(professionalProfile?.displayName);
  if (decision === "approved") {
    return `Autorização confirmada. ${professionalName} já pode acompanhar seus dados autorizados no Controle de Calorias.`;
  }
  return `Autorização recusada. ${professionalName} não terá acesso aos seus dados de acompanhamento.`;
}

function findPendingAccessFromWhatsappText(pendingAccesses: ProfessionalPatientAccess[], text: string) {
  const normalized = normalizeDecisionText(text).toUpperCase();
  const accessByCode = pendingAccesses.find(access => normalized.includes(buildProfessionalAccessDecisionCode(access.id)));
  if (accessByCode) return accessByCode;
  return pendingAccesses.length === 1 ? pendingAccesses[0] : null;
}

export async function processProfessionalAccessWhatsappResponse(patientUserId: number, text: string) {
  const decision = parseProfessionalAccessWhatsappDecision(text);
  if (!decision) return null;

  const pendingAccesses = (await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY))
    .filter(access => access.status === "pending");
  if (!pendingAccesses.length) return null;

  const access = findPendingAccessFromWhatsappText(pendingAccesses, text);
  if (!access) {
    return {
      handled: true,
      action: "professional_access_decision_ambiguous",
      reply: "Encontrei mais de uma solicitação pendente. Responda com AUTORIZAR ou NEGAR seguido do código recebido na mensagem do profissional.",
      eventType: "professional.access.whatsapp_decision_ambiguous",
      detail: "Resposta de autorização profissional sem código suficiente para identificar a solicitação.",
    };
  }

  const now = Date.now();
  const updated: ProfessionalPatientAccess = decision === "approved"
    ? {
        ...access,
        status: "approved",
        approvedAt: now,
        revokedAt: null,
        rejectedAt: null,
        respondedAt: now,
        responseOrigin: "whatsapp",
        responseDecision: "approved",
      }
    : {
        ...access,
        status: "rejected",
        approvedAt: null,
        revokedAt: null,
        rejectedAt: now,
        respondedAt: now,
        responseOrigin: "whatsapp",
        responseDecision: "rejected",
      };

  await persistAccessForBothSides(updated);
  const professionalProfile = await getProfessionalProfile(access.professionalUserId);
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: decision === "approved" ? "access_approved" : "access_rejected",
  });

  const action = decision === "approved" ? "professional_access_approved" : "professional_access_rejected";
  return {
    handled: true,
    action,
    reply: buildDecisionReply(decision, professionalProfile),
    eventType: `professional.access.whatsapp_${decision}`,
    detail: `Solicitação de acompanhamento ${decision === "approved" ? "aprovada" : "recusada"} via WhatsApp pela pessoa acompanhada #${patientUserId}.`,
    data: publicAccess(updated),
  };
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
  const professionalProfile = await assertActiveProfessionalProfile(professionalUserId);

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
    await persistAccessForBothSides(existing);
    return {
      ...publicAccess(existing),
      patient,
      authorizationMessage: existing.authorizationMessageStatus
        ? {
            status: existing.authorizationMessageStatus,
            detail: existing.authorizationMessageError ?? "Solicitação já registrada anteriormente.",
          }
        : null,
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
    rejectedAt: null,
    respondedAt: null,
    responseOrigin: null,
    responseDecision: null,
    authorizationMessageStatus: null,
    authorizationMessageSentAt: null,
    authorizationMessageError: null,
  };
  await persistAccessForBothSides(access);
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: patient.userId,
    eventType: "access_requested",
  });
  const authorizationMessage = await sendProfessionalAccessAuthorizationWhatsapp(access, professionalProfile);
  return {
    ...publicAccess(authorizationMessage.access),
    patient,
    authorizationMessage: {
      status: authorizationMessage.status,
      detail: authorizationMessage.detail,
    },
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
  const [patientAccesses, professionalSideAccesses] = await Promise.all([
    loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY),
    loadProfessionalAccessesForPatient(patientUserId),
  ]);

  const patientAccessIds = new Set(patientAccesses.map(a => a.id));
  const missing = professionalSideAccesses.filter(a => !patientAccessIds.has(a.id));
  if (missing.length > 0) {
    await Promise.all(missing.map(access => persistAccessForBothSides(access)));
    missing.forEach(a => patientAccesses.push(a));
  }

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
  const now = Date.now();
  const approved = {
    ...access,
    status: "approved" as const,
    approvedAt: now,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: now,
    responseOrigin: "web" as const,
    responseDecision: "approved" as const,
  };
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
  const now = Date.now();
  const revoked = {
    ...access,
    status: "revoked" as const,
    revokedAt: now,
    respondedAt: now,
    responseOrigin: "web" as const,
    responseDecision: "revoked" as const,
  };
  await persistAccessForBothSides(revoked);
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_revoked",
  });
  return publicAccess(revoked);
}

export async function getProfessionalPatientDashboard(professionalUserId: number, patientUserId: number, weekOffset = 0) {
  await assertApprovedAccess(professionalUserId, patientUserId);
  const [bundle, recentMeals, patient, nutritionGoal] = await Promise.all([
    getWeeklyReportBundle(patientUserId, weekOffset),
    listUserMeals(patientUserId),
    getUserSummary(patientUserId),
    getNutritionGoal(patientUserId),
  ]);

  return {
    patientId: patientUserId,
    patient,
    weeklyAdherence: bundle.progress.summary.totalGoalCalories
      ? Math.min(Math.round((bundle.progress.summary.totalCalories / bundle.progress.summary.totalGoalCalories) * 100), 100)
      : 0,
    calories: {
      consumed: bundle.progress.summary.totalCalories,
      planned: bundle.progress.summary.totalGoalCalories,
      burned: bundle.progress.summary.totalExerciseCalories,
    },
    macros: {
      protein: Math.round(bundle.progress.summary.averageProtein * bundle.weekly.length),
      carbs: Math.round(bundle.weekly.reduce((acc, day) => acc + day.carbs, 0)),
      fat: Math.round(bundle.weekly.reduce((acc, day) => acc + day.fat, 0)),
    },
    weight: bundle.progress.weight,
    nutritionGoal,
    weeklyReport: bundle.weekly,
    progress: bundle.progress,
    insights: bundle.insights,
    quality: bundle.quality,
    meals: recentMeals.slice(0, 20),
    comments: comments.filter(comment => comment.professionalUserId === professionalUserId && comment.patientUserId === patientUserId),
    goalSuggestions: goalSuggestions.filter(item => item.professionalUserId === professionalUserId && item.patientUserId === patientUserId),
    mealSuggestions: mealSuggestions.filter(item => item.professionalUserId === professionalUserId && item.patientUserId === patientUserId),
  };
}

export async function getProfessionalPatientPeriodBundle(
  professionalUserId: number,
  patientUserId: number,
  range: { startDate: string; endDate: string },
) {
  await assertApprovedAccess(professionalUserId, patientUserId);
  return getPeriodReportBundle(patientUserId, range);
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
