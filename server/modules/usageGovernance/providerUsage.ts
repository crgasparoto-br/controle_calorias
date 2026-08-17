import crypto from "node:crypto";
import { getUserIdByWhatsappPhone } from "../../db";
import { recordUsageEvent, type UsageEventInput } from "../../repositories/usageGovernanceRepository";

function opaqueProviderRef(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 40);
}

const TEST_PROVIDER_DISPATCH_STATE = Symbol.for("controle_calorias.usageProviderDispatchTestState");
type TestProviderDispatchState = { state: string; startedAt?: number };

function useMemoryProviderDispatchForTests() {
  return process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE === "memory";
}

function testProviderDispatchState() {
  const root = globalThis as Record<PropertyKey, unknown>;
  const existing = root[TEST_PROVIDER_DISPATCH_STATE];
  if (existing instanceof Map) return existing as Map<string, TestProviderDispatchState>;
  const created = new Map<string, TestProviderDispatchState>();
  root[TEST_PROVIDER_DISPATCH_STATE] = created;
  return created;
}

type MetaWhatsAppUsageBaseInput = {
  userId?: number | null;
  recipientPhone?: string | null;
  sourceMessageId: string;
  sequenceIndex: number;
  messageType: string;
  role: "primary" | "auxiliary";
  attemptKind?: "original" | "fallback";
  occurredAt?: Date;
};

export type MetaWhatsAppUsageReservation = {
  prepared: true;
  created: boolean;
  idempotencyKey: string;
  correlationId: string;
};

type MetaWhatsAppUsagePreparationFailure = {
  prepared: false;
  created: false;
  reason: "missing_correlation" | "unattributed";
};

async function buildMetaWhatsAppUsageEvent(
  input: MetaWhatsAppUsageBaseInput,
  state: "success" | "provider_dispatch_reserved",
  usedFallback: boolean,
): Promise<
  | { ok: true; event: UsageEventInput; idempotencyKey: string; correlationId: string }
  | { ok: false; reason: "missing_correlation" | "unattributed" }
> {
  const sourceMessageId = input.sourceMessageId.trim();
  if (!sourceMessageId) return { ok: false, reason: "missing_correlation" };

  const resolvedUserId = input.userId ?? (input.recipientPhone ? await getUserIdByWhatsappPhone(input.recipientPhone) : null);
  if (!resolvedUserId) return { ok: false, reason: "unattributed" };

  // WhatsApp transport is imported by flows that do not need billing. Keep both
  // heavy dependencies behind the attributable-event boundary so importing the
  // transport cannot initialize billing persistence through usage governance.
  const [{ billingService }, { USAGE_RULE_VERSION }] = await Promise.all([
    import("../billing/service"),
    import("./service"),
  ]);
  const status = await billingService.getUserSubscriptionStatus(resolvedUserId);
  const access = status.access;
  const sponsored = access.reason === "sponsored_by_professional" && Boolean(access.sponsorUserId);
  const sponsorUserId = sponsored ? Number(access.sponsorUserId) : null;
  const effectiveSubscription = sponsored ? status.professionalSubscription : status.subscription;
  const payerUserId = sponsorUserId ?? resolvedUserId;
  const effectivePlanCode = access.planCode ?? effectiveSubscription?.planCode ?? status.subscription?.planCode ?? null;
  const correlationRef = opaqueProviderRef(sourceMessageId);
  // The logical root remains stable across replay, while each physical provider
  // attempt receives its own durable identity and ledger row.
  const attemptKind = input.attemptKind ?? (usedFallback ? "fallback" : "original");
  const physicalMessageKey = opaqueProviderRef(`${sourceMessageId}:${input.sequenceIndex}:${attemptKind}`);
  const idempotencyKey = `meta:whatsapp:${physicalMessageKey}`;
  const correlationId = `meta:whatsapp:${correlationRef}`;

  return {
    ok: true,
    idempotencyKey,
    correlationId,
    event: {
      id: crypto.randomUUID(),
      idempotencyKey,
      beneficiaryUserId: resolvedUserId,
      patientUserId: sponsorUserId ? resolvedUserId : null,
      sponsorUserId,
      payerUserId,
      subscriptionId: effectiveSubscription?.id ?? null,
      versionCode: effectivePlanCode,
      billingCycle: effectiveSubscription?.billingCycle ?? null,
      accessSource: access.reason,
      operation: `whatsapp_${input.messageType}`,
      channel: "whatsapp",
      provider: "meta",
      model: null,
      unitType: "message",
      unitCount: 1,
      estimatedCostMicros: null,
      effectiveCostMicros: null,
      currency: null,
      eventState: state,
      attemptRole: usedFallback ? "fallback" : input.role,
      retryRootKey: usedFallback ? correlationId : null,
      correlationId,
      environment: process.env.NODE_ENV ?? "development",
      ruleVersion: USAGE_RULE_VERSION,
      metadata: {
        transport: "whatsapp_cloud_api",
        messageType: input.messageType,
        outboundRole: input.role,
        usedFallback,
        attemptKind,
        measurementState: state === "provider_dispatch_reserved" ? "reserved_before_provider_call" : "finalized",
        pricingState: "unpriced_pending_provider_reconciliation",
      },
      occurredAt: input.occurredAt ?? new Date(),
    },
  };
}

/**
 * Legacy/post-send helper retained for callers that already own provider-call
 * durability. The central WhatsApp transports use prepare/claim/finalize below.
 */
export async function recordMetaWhatsAppOutboundUsage(input: MetaWhatsAppUsageBaseInput & { usedFallback: boolean }) {
  const built = await buildMetaWhatsAppUsageEvent(
    { ...input, attemptKind: input.usedFallback ? "fallback" : "original" },
    "success",
    input.usedFallback,
  );
  if (built.ok === false) return { created: false, reason: built.reason };
  return recordUsageEvent(built.event);
}

/**
 * Persist the idempotent usage position before the first outbound provider call.
 * A successful reservation is the durable proof that prevents an accepted Meta
 * send from becoming invisible if the process/database fails after the effect.
 */
export async function prepareMetaWhatsAppOutboundUsage(
  input: MetaWhatsAppUsageBaseInput,
): Promise<MetaWhatsAppUsageReservation | MetaWhatsAppUsagePreparationFailure> {
  if (useMemoryProviderDispatchForTests()) {
    const sourceMessageId = input.sourceMessageId.trim();
    if (!sourceMessageId) return { prepared: false, created: false, reason: "missing_correlation" };
    const attemptKind = input.attemptKind ?? "original";
    const idempotencyKey = `meta:whatsapp:${opaqueProviderRef(`${sourceMessageId}:${input.sequenceIndex}:${attemptKind}`)}`;
    const correlationId = `meta:whatsapp:${opaqueProviderRef(sourceMessageId)}`;
    const states = testProviderDispatchState();
    const created = !states.has(idempotencyKey);
    if (created) states.set(idempotencyKey, { state: "provider_dispatch_reserved" });
    return { prepared: true, created, idempotencyKey, correlationId };
  }

  const built = await buildMetaWhatsAppUsageEvent(
    input,
    "provider_dispatch_reserved",
    input.attemptKind === "fallback",
  );
  if (built.ok === false) return { prepared: false, created: false, reason: built.reason };
  const recorded = await recordUsageEvent(built.event);
  return {
    prepared: true,
    created: recorded.created,
    idempotencyKey: built.idempotencyKey,
    correlationId: built.correlationId,
  };
}

/**
 * Atomically claim the durable position. Only the claimant may call Meta; a
 * concurrent/reprocessed request sees the existing state and must not repeat an
 * outbound call whose economic effect may already have happened.
 */
export async function claimMetaWhatsAppOutboundUsageDispatch(reservation: MetaWhatsAppUsageReservation) {
  if (useMemoryProviderDispatchForTests()) {
    const states = testProviderDispatchState();
    const current = states.get(reservation.idempotencyKey);
    if (current?.state === "provider_dispatch_reserved") {
      states.set(reservation.idempotencyKey, { state: "provider_dispatch_started", startedAt: Date.now() });
      return { claimed: true as const, state: "provider_dispatch_started" as const };
    }
    if (current?.state === "provider_dispatch_started" && current.startedAt && Date.now() - current.startedAt >= 5 * 60 * 1000) {
      states.set(reservation.idempotencyKey, { state: "provider_dispatch_uncertain" });
      return { claimed: false as const, state: "provider_dispatch_uncertain" as const };
    }
    return { claimed: false as const, state: current?.state ?? null };
  }
  const { claimUsageProviderDispatch } = await import("../../repositories/usageProviderDispatchRepository");
  return claimUsageProviderDispatch(reservation.idempotencyKey);
}

/**
 * Finalization is deliberately post-provider and idempotent. If it cannot be
 * persisted, `provider_dispatch_started` remains durable and visible for
 * reconciliation instead of silently losing the provider attempt.
 */
export async function finalizeMetaWhatsAppOutboundUsage(input: {
  reservation: MetaWhatsAppUsageReservation;
  messageType: string;
  role: "primary" | "auxiliary";
  usedFallback: boolean;
  effectiveOk: boolean;
  providerStatus?: number;
  providerStatusText?: string;
}) {
  if (useMemoryProviderDispatchForTests()) {
    const states = testProviderDispatchState();
    const current = states.get(input.reservation.idempotencyKey);
    if (current?.state === "provider_dispatch_started") {
      const state = input.effectiveOk ? "success" : "failure";
      states.set(input.reservation.idempotencyKey, { state });
      return { finalized: true as const, state };
    }
    return { finalized: false as const, state: current?.state ?? null };
  }

  const { finalizeUsageProviderDispatch } = await import("../../repositories/usageProviderDispatchRepository");
  return finalizeUsageProviderDispatch({
    idempotencyKey: input.reservation.idempotencyKey,
    eventState: input.effectiveOk ? "success" : "failure",
    operation: `whatsapp_${input.messageType}`,
    attemptRole: input.usedFallback ? "fallback" : input.role,
    retryRootKey: input.usedFallback ? input.reservation.correlationId : null,
    metadata: {
      transport: "whatsapp_cloud_api",
      messageType: input.messageType,
      outboundRole: input.role,
      usedFallback: input.usedFallback,
      providerStatus: input.providerStatus ?? null,
      providerStatusText: input.providerStatusText ?? null,
      measurementState: "finalized",
      pricingState: "unpriced_pending_provider_reconciliation",
    },
  });
}
