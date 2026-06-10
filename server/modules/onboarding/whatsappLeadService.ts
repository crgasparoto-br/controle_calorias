import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { registerLocalUser } from "../../_core/localAuth";
import { getDb, logInferenceEvent, normalizeWhatsAppPhoneNumber, upsertUserWhatsappConnection } from "../../db";
import { completeOnboarding } from "./service";
import type { OnboardingInput } from "./schemas";
import type { WhatsappOnboardingConsents } from "./whatsappLeadSchemas";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");

type LeadStatus = "lead_whatsapp" | "pending_onboarding" | "active" | "expired" | "canceled";

type WhatsappOnboardingLead = {
  id: number;
  phoneNumber: string;
  displayName: string | null;
  status: LeadStatus;
  tokenHash: string;
  tokenExpiresAt: Date;
  tokenUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
};

const memoryLeadsByPhone = new Map<string, WhatsappOnboardingLead>();
const memoryLeadsByTokenHash = new Map<string, WhatsappOnboardingLead>();
let memoryLeadSequence = 1;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function maskPhoneNumber(phoneNumber: string) {
  const digits = normalizeWhatsAppPhoneNumber(phoneNumber);
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function buildOnboardingUrl(token: string) {
  const path = `/onboarding/whatsapp/${token}`;
  return APP_BASE_URL ? `${APP_BASE_URL}${path}` : path;
}

function isLeadExpired(lead: Pick<WhatsappOnboardingLead, "tokenExpiresAt" | "tokenUsedAt" | "status">, now = new Date()) {
  return lead.status === "expired" || Boolean(lead.tokenUsedAt) || lead.tokenExpiresAt.getTime() <= now.getTime();
}

function publicLeadView(lead: WhatsappOnboardingLead) {
  return {
    phoneNumberMasked: maskPhoneNumber(lead.phoneNumber),
    displayName: lead.displayName,
    status: lead.status,
    expiresAt: lead.tokenExpiresAt.toISOString(),
  };
}

async function executeRaw<T = unknown>(query: ReturnType<typeof sql>) {
  const db = await getDb();
  if (!db) return null;
  return db.execute(query) as Promise<T>;
}

function firstRow<T>(result: unknown): T | null {
  const rows = Array.isArray(result) ? result[0] : (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) && rows.length ? rows[0] as T : null;
}

function rowToLead(row: any): WhatsappOnboardingLead {
  return {
    id: Number(row.id),
    phoneNumber: row.phone_number,
    displayName: row.display_name ?? null,
    status: row.status,
    tokenHash: row.token_hash,
    tokenExpiresAt: new Date(row.token_expires_at),
    tokenUsedAt: row.token_used_at ? new Date(row.token_used_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastMessageAt: new Date(row.last_message_at),
  };
}

async function findLeadByTokenHash(tokenHash: string) {
  const result = await executeRaw(sql`select * from whatsapp_onboarding_leads where token_hash = ${tokenHash} limit 1`);
  if (!result) return memoryLeadsByTokenHash.get(tokenHash) ?? null;
  const row = firstRow<any>(result);
  return row ? rowToLead(row) : null;
}

async function findLeadByPhone(phoneNumber: string) {
  const result = await executeRaw(sql`select * from whatsapp_onboarding_leads where phone_number = ${phoneNumber} limit 1`);
  if (!result) return memoryLeadsByPhone.get(phoneNumber) ?? null;
  const row = firstRow<any>(result);
  return row ? rowToLead(row) : null;
}

async function upsertLead(input: { phoneNumber: string; displayName?: string | null; tokenHash: string; expiresAt: Date }) {
  const existing = await findLeadByPhone(input.phoneNumber);
  const now = new Date();
  const displayName = input.displayName?.trim() || existing?.displayName || null;

  if (!existing) {
    await executeRaw(sql`
      insert into whatsapp_onboarding_leads
        (phone_number, display_name, origin, status, token_hash, token_expires_at, last_message_at, created_at, updated_at)
      values
        (${input.phoneNumber}, ${displayName}, 'whatsapp', 'pending_onboarding', ${input.tokenHash}, ${input.expiresAt}, ${now}, ${now}, ${now})
    `);

    const lead: WhatsappOnboardingLead = {
      id: memoryLeadSequence++,
      phoneNumber: input.phoneNumber,
      displayName,
      status: "pending_onboarding",
      tokenHash: input.tokenHash,
      tokenExpiresAt: input.expiresAt,
      tokenUsedAt: null,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    };
    memoryLeadsByPhone.set(input.phoneNumber, lead);
    memoryLeadsByTokenHash.set(input.tokenHash, lead);
    return lead;
  }

  const shouldRotateToken = isLeadExpired(existing, now) || existing.status === "active";
  const tokenHash = shouldRotateToken ? input.tokenHash : existing.tokenHash;
  const expiresAt = shouldRotateToken ? input.expiresAt : existing.tokenExpiresAt;
  const status: LeadStatus = existing.status === "active" ? "active" : "pending_onboarding";

  await executeRaw(sql`
    update whatsapp_onboarding_leads
    set display_name = ${displayName}, status = ${status}, token_hash = ${tokenHash}, token_expires_at = ${expiresAt}, token_used_at = null, last_message_at = ${now}, updated_at = ${now}
    where phone_number = ${input.phoneNumber}
  `);

  const lead = { ...existing, displayName, status, tokenHash, tokenExpiresAt: expiresAt, tokenUsedAt: null, updatedAt: now, lastMessageAt: now };
  memoryLeadsByPhone.set(input.phoneNumber, lead);
  memoryLeadsByTokenHash.set(tokenHash, lead);
  return lead;
}

export async function createWhatsappOnboardingLead(input: { phoneNumber: string; displayName?: string | null }) {
  const normalizedPhone = normalizeWhatsAppPhoneNumber(input.phoneNumber);
  if (normalizedPhone.length < 10 || normalizedPhone.length > 16) {
    throw new Error("INVALID_WHATSAPP_PHONE");
  }

  const token = createToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const lead = await upsertLead({ phoneNumber: normalizedPhone, displayName: input.displayName, tokenHash, expiresAt });

  logInferenceEvent({
    userId: null,
    origin: "whatsapp",
    status: "success",
    eventType: "whatsapp.onboarding_started",
    detail: `Fluxo de onboarding iniciado para telefone mascarado ${maskPhoneNumber(normalizedPhone)}.`,
  });

  return {
    lead: publicLeadView(lead),
    url: buildOnboardingUrl(token),
    token,
  };
}

export async function getWhatsappOnboardingLeadByToken(token: string) {
  const lead = await findLeadByTokenHash(hashToken(token));
  if (!lead || isLeadExpired(lead)) {
    return null;
  }

  await executeRaw(sql`update whatsapp_onboarding_leads set updated_at = ${new Date()} where id = ${lead.id}`);
  return publicLeadView(lead);
}

async function markLeadConverted(lead: WhatsappOnboardingLead, userId: number) {
  const now = new Date();
  await executeRaw(sql`
    update whatsapp_onboarding_leads
    set status = 'active', converted_user_id = ${userId}, converted_at = ${now}, token_used_at = ${now}, updated_at = ${now}
    where id = ${lead.id}
  `);
  memoryLeadsByPhone.set(lead.phoneNumber, { ...lead, status: "active", tokenUsedAt: now, updatedAt: now });
}

async function persistConsents(userId: number, consents: WhatsappOnboardingConsents) {
  const now = new Date();
  const payload = JSON.stringify({
    version: "2026-06-10",
    source: "whatsapp_onboarding",
    acceptedAt: now.toISOString(),
    terms: consents.acceptedTerms,
    privacyPolicy: consents.acceptedPrivacyPolicy,
    healthDataProcessing: consents.acceptedHealthDataProcessing,
    operationalWhatsapp: consents.acceptedOperationalWhatsapp,
    marketingWhatsapp: consents.acceptedMarketingWhatsapp,
  });

  await executeRaw(sql`
    insert into userPreferences (userId, preferenceKey, preferenceValue, createdAt, updatedAt)
    values (${userId}, 'whatsapp_onboarding_consents', ${payload}, ${now}, ${now})
    on duplicate key update preferenceValue = ${payload}, updatedAt = ${now}
  `);
}

export async function completeWhatsappOnboarding(input: {
  token: string;
  email: string;
  password: string;
  profile: OnboardingInput;
  consents: WhatsappOnboardingConsents;
}) {
  const lead = await findLeadByTokenHash(hashToken(input.token));
  if (!lead || isLeadExpired(lead)) {
    throw new Error("INVALID_OR_EXPIRED_ONBOARDING_TOKEN");
  }

  const user = await registerLocalUser({
    name: input.profile.name,
    email: input.email,
    password: input.password,
  });

  await completeOnboarding(user.id, input.profile);
  await upsertUserWhatsappConnection({
    userId: user.id,
    phoneNumber: lead.phoneNumber,
    displayName: input.profile.name,
  });
  await persistConsents(user.id, input.consents);
  await markLeadConverted(lead, user.id);

  logInferenceEvent({
    userId: user.id,
    origin: "web",
    status: "success",
    eventType: "whatsapp.onboarding_completed",
    detail: "Onboarding iniciado pelo WhatsApp concluído sem etapa de pagamento.",
  });

  return user;
}
