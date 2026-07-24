import crypto from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  getLocalUserById,
  registerLocalUser,
} from "../../_core/localAuth";
import {
  getDb,
  logInferenceEvent,
  normalizeWhatsAppPhoneNumber,
  upsertUserWhatsappConnection,
} from "../../db";
import { billingService } from "../billing/service";
import { completeOnboarding } from "./service";
import type { OnboardingInput } from "./schemas";
import type { WhatsappOnboardingConsents } from "./whatsappLeadSchemas";
import { sendOnboardingWelcomeWhatsapp } from "./webGreetingService";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const APP_BASE_URL = (
  process.env.APP_BASE_URL ||
  process.env.PUBLIC_APP_URL ||
  ""
).replace(/\/$/, "");

type LeadStatus =
  | "lead_whatsapp"
  | "pending_onboarding"
  | "converting"
  | "pending_activation"
  | "active"
  | "expired"
  | "canceled";

type WhatsappOnboardingLead = {
  id: number;
  phoneNumber: string;
  displayName: string | null;
  status: LeadStatus;
  tokenHash: string;
  tokenExpiresAt: Date;
  tokenUsedAt: Date | null;
  convertedUserId: number | null;
  convertedAt: Date | null;
  activationSource: string | null;
  activatedAt: Date | null;
  completionErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
};

type CompletionClaim = {
  lead: WhatsappOnboardingLead;
  resumed: boolean;
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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
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

function isConvertedStatus(status: LeadStatus) {
  return (
    status === "converting" ||
    status === "pending_activation" ||
    status === "active"
  );
}

function isLeadExpired(
  lead: Pick<
    WhatsappOnboardingLead,
    "tokenExpiresAt" | "tokenUsedAt" | "status"
  >,
  now = new Date()
) {
  return (
    lead.status === "expired" ||
    lead.status === "canceled" ||
    isConvertedStatus(lead.status) ||
    Boolean(lead.tokenUsedAt) ||
    lead.tokenExpiresAt.getTime() <= now.getTime()
  );
}

function publicLeadView(lead: WhatsappOnboardingLead) {
  return {
    phoneNumberMasked: maskPhoneNumber(lead.phoneNumber),
    displayName: lead.displayName,
    status: lead.status,
    expiresAt: lead.tokenExpiresAt.toISOString(),
  };
}

async function executeRaw<T = unknown>(query: SQL) {
  const db = await getDb();
  if (!db) return null;
  return db.execute(query) as Promise<T>;
}

function firstRow<T>(result: unknown): T | null {
  const rows = Array.isArray(result)
    ? result[0]
    : (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) && rows.length ? (rows[0] as T) : null;
}

function affectedRows(result: unknown) {
  const header = Array.isArray(result)
    ? result[0]
    : (result as { rows?: unknown })?.rows;
  return Number((header as { affectedRows?: number } | null)?.affectedRows ?? 0);
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
    convertedUserId:
      row.converted_user_id === null || row.converted_user_id === undefined
        ? null
        : Number(row.converted_user_id),
    convertedAt: row.converted_at ? new Date(row.converted_at) : null,
    activationSource: row.activation_source ?? null,
    activatedAt: row.activated_at ? new Date(row.activated_at) : null,
    completionErrorCode: row.completion_error_code ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastMessageAt: new Date(row.last_message_at),
  };
}

async function findLeadByTokenHash(tokenHash: string) {
  const result = await executeRaw(
    sql`select * from whatsapp_onboarding_leads where token_hash = ${tokenHash} limit 1`
  );
  if (!result) return memoryLeadsByTokenHash.get(tokenHash) ?? null;
  const row = firstRow<any>(result);
  return row ? rowToLead(row) : null;
}

async function findLeadByPhone(phoneNumber: string) {
  const result = await executeRaw(
    sql`select * from whatsapp_onboarding_leads where phone_number = ${phoneNumber} limit 1`
  );
  if (!result) return memoryLeadsByPhone.get(phoneNumber) ?? null;
  const row = firstRow<any>(result);
  return row ? rowToLead(row) : null;
}

async function findLeadByConvertedUserId(userId: number) {
  const result = await executeRaw(
    sql`select * from whatsapp_onboarding_leads where converted_user_id = ${userId} order by converted_at desc limit 1`
  );
  if (!result) {
    return (
      [...memoryLeadsByPhone.values()].find(
        lead => lead.convertedUserId === userId
      ) ?? null
    );
  }
  const row = firstRow<any>(result);
  return row ? rowToLead(row) : null;
}

function persistMemoryLead(lead: WhatsappOnboardingLead, previousTokenHash?: string) {
  if (previousTokenHash && previousTokenHash !== lead.tokenHash) {
    memoryLeadsByTokenHash.delete(previousTokenHash);
  }
  memoryLeadsByPhone.set(lead.phoneNumber, lead);
  memoryLeadsByTokenHash.set(lead.tokenHash, lead);
}

async function upsertLead(input: {
  phoneNumber: string;
  displayName?: string | null;
  tokenHash: string;
  expiresAt: Date;
}) {
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
      convertedUserId: null,
      convertedAt: null,
      activationSource: null,
      activatedAt: null,
      completionErrorCode: null,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    };
    persistMemoryLead(lead);
    return lead;
  }

  if (isConvertedStatus(existing.status)) {
    await executeRaw(sql`
      update whatsapp_onboarding_leads
      set display_name = ${displayName}, last_message_at = ${now}, updated_at = ${now}
      where phone_number = ${input.phoneNumber}
    `);
    const convertedLead = {
      ...existing,
      displayName,
      updatedAt: now,
      lastMessageAt: now,
    };
    persistMemoryLead(convertedLead);
    return convertedLead;
  }

  const shouldRotateToken = isLeadExpired(existing, now);
  const tokenHash = shouldRotateToken ? input.tokenHash : existing.tokenHash;
  const expiresAt = shouldRotateToken ? input.expiresAt : existing.tokenExpiresAt;

  await executeRaw(sql`
    update whatsapp_onboarding_leads
    set display_name = ${displayName}, status = 'pending_onboarding', token_hash = ${tokenHash}, token_expires_at = ${expiresAt}, token_used_at = null, completion_error_code = null, last_message_at = ${now}, updated_at = ${now}
    where phone_number = ${input.phoneNumber}
  `);

  const lead: WhatsappOnboardingLead = {
    ...existing,
    displayName,
    status: "pending_onboarding",
    tokenHash,
    tokenExpiresAt: expiresAt,
    tokenUsedAt: null,
    completionErrorCode: null,
    updatedAt: now,
    lastMessageAt: now,
  };
  persistMemoryLead(lead, existing.tokenHash);
  return lead;
}

export async function createWhatsappOnboardingLead(input: {
  phoneNumber: string;
  displayName?: string | null;
}) {
  const normalizedPhone = normalizeWhatsAppPhoneNumber(input.phoneNumber);
  if (normalizedPhone.length < 10 || normalizedPhone.length > 16) {
    throw new Error("INVALID_WHATSAPP_PHONE");
  }

  const token = createToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const lead = await upsertLead({
    phoneNumber: normalizedPhone,
    displayName: input.displayName,
    tokenHash,
    expiresAt,
  });

  logInferenceEvent({
    userId: null,
    origin: "whatsapp",
    status: "success",
    eventType: isConvertedStatus(lead.status)
      ? "whatsapp.onboarding_already_converted"
      : "whatsapp.onboarding_started",
    detail: `Fluxo de onboarding consultado para telefone mascarado ${maskPhoneNumber(normalizedPhone)}.`,
  });

  return {
    lead: publicLeadView(lead),
    url: isConvertedStatus(lead.status)
      ? APP_BASE_URL
        ? `${APP_BASE_URL}/login`
        : "/login"
      : buildOnboardingUrl(token),
    token,
    alreadyConverted: isConvertedStatus(lead.status),
  };
}

export async function getWhatsappOnboardingLeadByToken(token: string) {
  const lead = await findLeadByTokenHash(hashToken(token));
  if (!lead || isLeadExpired(lead)) {
    return null;
  }

  await executeRaw(
    sql`update whatsapp_onboarding_leads set updated_at = ${new Date()} where id = ${lead.id}`
  );
  return publicLeadView(lead);
}

async function claimLeadForCompletion(tokenHash: string): Promise<CompletionClaim> {
  const now = new Date();
  const result = await executeRaw(sql`
    update whatsapp_onboarding_leads
    set status = 'converting', token_used_at = ${now}, completion_error_code = null, updated_at = ${now}
    where token_hash = ${tokenHash}
      and status in ('lead_whatsapp', 'pending_onboarding')
      and token_used_at is null
      and token_expires_at > ${now}
  `);

  if (result) {
    if (affectedRows(result) === 1) {
      const claimed = await findLeadByTokenHash(tokenHash);
      if (!claimed) throw new Error("INVALID_OR_EXPIRED_ONBOARDING_TOKEN");
      return { lead: claimed, resumed: false };
    }

    const existing = await findLeadByTokenHash(tokenHash);
    if (existing?.status === "converting" && existing.convertedUserId) {
      return { lead: existing, resumed: true };
    }
    if (existing?.status === "converting") {
      throw new Error("ONBOARDING_COMPLETION_IN_PROGRESS");
    }
    throw new Error("INVALID_OR_EXPIRED_ONBOARDING_TOKEN");
  }

  const existing = memoryLeadsByTokenHash.get(tokenHash);
  if (!existing) throw new Error("INVALID_OR_EXPIRED_ONBOARDING_TOKEN");
  if (existing.status === "converting" && existing.convertedUserId) {
    return { lead: existing, resumed: true };
  }
  if (existing.status === "converting") {
    throw new Error("ONBOARDING_COMPLETION_IN_PROGRESS");
  }
  if (
    !["lead_whatsapp", "pending_onboarding"].includes(existing.status) ||
    existing.tokenUsedAt ||
    existing.tokenExpiresAt.getTime() <= now.getTime()
  ) {
    throw new Error("INVALID_OR_EXPIRED_ONBOARDING_TOKEN");
  }

  const claimed: WhatsappOnboardingLead = {
    ...existing,
    status: "converting",
    tokenUsedAt: now,
    completionErrorCode: null,
    updatedAt: now,
  };
  persistMemoryLead(claimed);
  return { lead: claimed, resumed: false };
}

async function persistClaimedUser(lead: WhatsappOnboardingLead, userId: number) {
  const now = new Date();
  const result = await executeRaw(sql`
    update whatsapp_onboarding_leads
    set converted_user_id = ${userId}, converted_at = coalesce(converted_at, ${now}), updated_at = ${now}
    where id = ${lead.id} and status = 'converting'
  `);
  if (result && affectedRows(result) !== 1) {
    throw new Error("ONBOARDING_LEAD_CLAIM_LOST");
  }
  const updated: WhatsappOnboardingLead = {
    ...lead,
    convertedUserId: userId,
    convertedAt: lead.convertedAt ?? now,
    updatedAt: now,
  };
  persistMemoryLead(updated);
  return updated;
}

async function finalizeLeadConversion(input: {
  lead: WhatsappOnboardingLead;
  userId: number;
  allowed: boolean;
  source: string;
}) {
  const now = new Date();
  const status: LeadStatus = input.allowed ? "active" : "pending_activation";
  const activationSource = input.allowed ? input.source : null;
  const activatedAt = input.allowed ? now : null;

  await executeRaw(sql`
    update whatsapp_onboarding_leads
    set status = ${status}, converted_user_id = ${input.userId}, converted_at = coalesce(converted_at, ${now}), activation_source = ${activationSource}, activated_at = ${activatedAt}, completion_error_code = null, updated_at = ${now}
    where id = ${input.lead.id} and status = 'converting' and converted_user_id = ${input.userId}
  `);

  const finalized: WhatsappOnboardingLead = {
    ...input.lead,
    status,
    convertedUserId: input.userId,
    convertedAt: input.lead.convertedAt ?? now,
    activationSource,
    activatedAt,
    completionErrorCode: null,
    updatedAt: now,
  };
  persistMemoryLead(finalized);
  return finalized;
}

async function recordCompletionFailure(
  lead: WhatsappOnboardingLead,
  userId: number | null,
  error: unknown
) {
  const now = new Date();
  const errorCode =
    error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN_ERROR";
  const status: LeadStatus = userId ? "converting" : "pending_onboarding";
  const tokenUsedAt = userId ? lead.tokenUsedAt : null;

  if (userId) {
    await executeRaw(sql`
      update whatsapp_onboarding_leads
      set status = 'converting', token_used_at = ${tokenUsedAt}, converted_user_id = coalesce(converted_user_id, ${userId}), converted_at = coalesce(converted_at, ${now}), completion_error_code = ${errorCode}, updated_at = ${now}
      where id = ${lead.id}
    `);
  } else {
    await executeRaw(sql`
      update whatsapp_onboarding_leads
      set status = 'pending_onboarding', token_used_at = null, completion_error_code = ${errorCode}, updated_at = ${now}
      where id = ${lead.id}
    `);
  }

  persistMemoryLead({
    ...lead,
    status,
    tokenUsedAt,
    convertedUserId: userId ?? lead.convertedUserId,
    convertedAt: userId ? lead.convertedAt ?? now : lead.convertedAt,
    completionErrorCode: errorCode,
    updatedAt: now,
  });
}

async function persistConsents(
  userId: number,
  consents: WhatsappOnboardingConsents
) {
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

export async function getWhatsappOnboardingActivationState(userId: number) {
  const lead = await findLeadByConvertedUserId(userId);
  if (!lead) return null;
  return {
    status: lead.status,
    activationSource: lead.activationSource,
    activatedAt: lead.activatedAt,
    completionErrorCode: lead.completionErrorCode,
  };
}

export async function activateWhatsappOnboardingUser(
  userId: number,
  source?: string
) {
  const eligibility = await billingService.getUserEntitlements(userId);
  if (!eligibility.allowed) {
    return {
      status: "blocked" as const,
      eligibility,
    };
  }

  const lead = await findLeadByConvertedUserId(userId);
  if (!lead) {
    return {
      status: "no_onboarding_lead" as const,
      eligibility,
    };
  }
  if (lead.status === "converting") {
    return {
      status: "completion_in_progress" as const,
      eligibility,
    };
  }
  if (lead.status !== "pending_activation" && lead.status !== "active") {
    return {
      status: "not_applicable" as const,
      eligibility,
    };
  }

  const activationSource = source ?? eligibility.reason;
  const now = new Date();
  let activated = lead.status === "active";

  if (!activated) {
    const result = await executeRaw(sql`
      update whatsapp_onboarding_leads
      set status = 'active', activation_source = ${activationSource}, activated_at = coalesce(activated_at, ${now}), completion_error_code = null, updated_at = ${now}
      where id = ${lead.id} and status = 'pending_activation' and converted_user_id = ${userId}
    `);
    activated = result ? affectedRows(result) === 1 : true;
    if (activated) {
      persistMemoryLead({
        ...lead,
        status: "active",
        activationSource,
        activatedAt: lead.activatedAt ?? now,
        completionErrorCode: null,
        updatedAt: now,
      });
    }
  }

  const current = await findLeadByConvertedUserId(userId);
  if (!activated && current?.status !== "active") {
    return {
      status: "activation_conflict" as const,
      eligibility,
    };
  }

  await sendOnboardingWelcomeWhatsapp(userId);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "whatsapp.onboarding_activated",
    detail: `Onboarding ativado por origem comercial ${activationSource}.`,
  });

  return {
    status:
      lead.status === "active"
        ? ("already_active" as const)
        : ("activated" as const),
    eligibility,
  };
}

export async function completeWhatsappOnboarding(input: {
  token: string;
  email: string;
  password: string;
  profile: OnboardingInput;
  consents: WhatsappOnboardingConsents;
}) {
  const claim = await claimLeadForCompletion(hashToken(input.token));
  let lead = claim.lead;
  let userId = lead.convertedUserId;

  try {
    let user;
    if (userId) {
      user = await getLocalUserById(userId);
      if (!user || normalizeEmail(user.email ?? "") !== normalizeEmail(input.email)) {
        throw new Error("ONBOARDING_RECOVERY_ACCOUNT_MISMATCH");
      }
    } else {
      user = await registerLocalUser({
        name: input.profile.name,
        email: input.email,
        password: input.password,
      });
      userId = user.id;
      lead = await persistClaimedUser(lead, user.id);
    }

    await completeOnboarding(user.id, input.profile);
    await upsertUserWhatsappConnection({
      userId: user.id,
      phoneNumber: lead.phoneNumber,
      displayName: input.profile.name,
    });
    await persistConsents(user.id, input.consents);

    const eligibility = await billingService.getUserEntitlements(user.id);
    await finalizeLeadConversion({
      lead,
      userId: user.id,
      allowed: eligibility.allowed,
      source: eligibility.reason,
    });
    const nextAction = eligibility.allowed
      ? ("continue" as const)
      : ("await_activation" as const);

    logInferenceEvent({
      userId: user.id,
      origin: "web",
      status: eligibility.allowed ? "success" : "warning",
      eventType: eligibility.allowed
        ? "whatsapp.onboarding_completed"
        : "whatsapp.onboarding_pending_activation",
      detail: eligibility.allowed
        ? "Onboarding iniciado pelo WhatsApp concluído com elegibilidade válida."
        : "Cadastro concluído; uso nutricional aguarda elegibilidade comercial válida.",
    });

    if (eligibility.allowed) {
      await sendOnboardingWelcomeWhatsapp(user.id);
    }

    return {
      user,
      eligibility,
      nextAction,
      resumed: claim.resumed,
    };
  } catch (error) {
    await recordCompletionFailure(lead, userId, error);
    throw error;
  }
}

export function __resetWhatsappOnboardingLeadsForTests() {
  memoryLeadsByPhone.clear();
  memoryLeadsByTokenHash.clear();
  memoryLeadSequence = 1;
}
