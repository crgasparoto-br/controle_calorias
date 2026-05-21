import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { users } from "../../../drizzle/schema";
import { getDb, getDashboardSnapshot, getWeeklyProgress, getWeeklySummary, listUserMeals } from "../../db";
import type {
  ProfessionalCommentInput,
  ProfessionalGoalSuggestionInput,
  ProfessionalProfileInput,
  RequestPatientAccessInput,
} from "./schemas";

type AccessStatus = "pending" | "approved" | "revoked" | "rejected";

type ProfessionalProfile = {
  userId: number;
  displayName: string;
  registrationNumber?: string;
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
  goal: ProfessionalGoalSuggestionInput["goal"];
  createdAt: number;
};

type HistoryEvent = {
  id: string;
  actorUserId: number;
  patientUserId: number;
  professionalUserId: number;
  eventType: "profile_upserted" | "access_requested" | "access_approved" | "access_revoked" | "comment_created" | "goal_suggested";
  createdAt: number;
};

type UserSummary = {
  userId: number;
  name: string | null;
  email: string | null;
};

const profiles = new Map<number, ProfessionalProfile>();
const accesses = new Map<string, ProfessionalPatientAccess>();
const comments: ProfessionalComment[] = [];
const goalSuggestions: GoalSuggestion[] = [];
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
  if (!db) {
    throw new Error("A busca por paciente via e-mail depende do banco configurado neste ambiente.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const rows = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  const user = rows[0];
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

function getApprovedAccess(professionalUserId: number, patientUserId: number) {
  return Array.from(accesses.values()).find(access =>
    access.professionalUserId === professionalUserId &&
    access.patientUserId === patientUserId &&
    access.status === "approved",
  );
}

function assertApprovedAccess(professionalUserId: number, patientUserId: number) {
  const access = getApprovedAccess(professionalUserId, patientUserId);
  if (!access) {
    throw new Error("Acesso profissional não autorizado pelo paciente.");
  }
  return access;
}

export function upsertProfessionalProfile(userId: number, input: ProfessionalProfileInput) {
  const now = Date.now();
  const profile: ProfessionalProfile = {
    userId,
    displayName: input.displayName,
    registrationNumber: input.registrationNumber,
    createdAt: profiles.get(userId)?.createdAt ?? now,
    updatedAt: now,
  };
  profiles.set(userId, profile);
  pushHistory({
    actorUserId: userId,
    professionalUserId: userId,
    patientUserId: userId,
    eventType: "profile_upserted",
  });
  return profile;
}

export function getProfessionalProfile(userId: number) {
  return profiles.get(userId) ?? null;
}

export async function requestPatientAccess(professionalUserId: number, input: RequestPatientAccessInput) {
  const profile = profiles.get(professionalUserId);
  if (!profile) throw new Error("Crie seu perfil profissional antes de solicitar acesso.");

  const patient = await getUserSummaryByEmail(input.patientEmail);
  if (!patient?.email) {
    throw new Error("Nenhum paciente foi encontrado com esse e-mail.");
  }
  if (professionalUserId === patient.userId) throw new Error("Profissional e paciente precisam ser usuários diferentes.");

  const existing = Array.from(accesses.values()).find(access =>
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
  accesses.set(access.id, access);
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
  const professionalAccesses = Array.from(accesses.values()).filter(access => access.professionalUserId === professionalUserId);
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

export function listPatientAccessRequests(patientUserId: number) {
  return Array.from(accesses.values())
    .filter(access => access.patientUserId === patientUserId)
    .map(access => ({
      ...publicAccess(access),
      professional: profiles.get(access.professionalUserId) ?? null,
    }));
}

export function approvePatientAccess(patientUserId: number, accessId: string) {
  const access = accesses.get(accessId);
  if (!access || access.patientUserId !== patientUserId) throw new Error("Solicitação de acesso não encontrada.");
  if (access.status !== "pending") throw new Error("Apenas solicitações pendentes podem ser aprovadas.");
  const approved = { ...access, status: "approved" as const, approvedAt: Date.now(), revokedAt: null };
  accesses.set(accessId, approved);
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_approved",
  });
  return publicAccess(approved);
}

export function revokePatientAccess(patientUserId: number, accessId: string) {
  const access = accesses.get(accessId);
  if (!access || access.patientUserId !== patientUserId) throw new Error("Vínculo de acesso não encontrado.");
  const revoked = { ...access, status: "revoked" as const, revokedAt: Date.now() };
  accesses.set(accessId, revoked);
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_revoked",
  });
  return publicAccess(revoked);
}

export async function getProfessionalPatientDashboard(professionalUserId: number, patientUserId: number) {
  assertApprovedAccess(professionalUserId, patientUserId);
  const [dashboard, weeklyProgress, weeklyReport, meals, patient] = await Promise.all([
    getDashboardSnapshot(patientUserId),
    getWeeklyProgress(patientUserId),
    getWeeklySummary(patientUserId),
    listUserMeals(patientUserId),
    getUserSummary(patientUserId),
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
    weeklyReport,
    meals: meals.slice(0, 20),
    comments: comments.filter(comment => comment.professionalUserId === professionalUserId && comment.patientUserId === patientUserId),
    goalSuggestions: goalSuggestions.filter(item => item.professionalUserId === professionalUserId && item.patientUserId === patientUserId),
  };
}

export function addProfessionalComment(professionalUserId: number, input: ProfessionalCommentInput) {
  assertApprovedAccess(professionalUserId, input.patientId);
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

export function suggestGoalAdjustment(professionalUserId: number, input: ProfessionalGoalSuggestionInput) {
  assertApprovedAccess(professionalUserId, input.patientId);
  const suggestion: GoalSuggestion = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    rationale: input.rationale,
    goal: input.goal,
    createdAt: Date.now(),
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

export function listProfessionalHistory(userId: number) {
  return history.filter(event => event.professionalUserId === userId || event.patientUserId === userId);
}
