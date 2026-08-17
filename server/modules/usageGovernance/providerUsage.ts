import crypto from "node:crypto";
import { getUserIdByWhatsappPhone } from "../../db";
import { recordUsageEvent } from "../../repositories/usageGovernanceRepository";

function opaqueProviderRef(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 40);
}

export async function recordMetaWhatsAppOutboundUsage(input: {
  userId?: number | null;
  recipientPhone?: string | null;
  sourceMessageId: string;
  sequenceIndex: number;
  messageType: string;
  role: "primary" | "auxiliary";
  usedFallback: boolean;
  occurredAt?: Date;
}) {
  const sourceMessageId = input.sourceMessageId.trim();
  if (!sourceMessageId) return { created: false, reason: "missing_correlation" as const };

  const resolvedUserId = input.userId ?? (input.recipientPhone ? await getUserIdByWhatsappPhone(input.recipientPhone) : null);
  if (!resolvedUserId) return { created: false, reason: "unattributed" as const };

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
  // A posicao logica e a identidade do envio. Fallback nao pode criar uma segunda
  // chave em um reprocessamento da mesma mensagem inbound.
  const physicalMessageKey = opaqueProviderRef(`${sourceMessageId}:${input.sequenceIndex}`);

  return recordUsageEvent({
    id: crypto.randomUUID(),
    idempotencyKey: `meta:whatsapp:${physicalMessageKey}`,
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
    eventState: "success",
    attemptRole: input.usedFallback ? "fallback" : input.role,
    retryRootKey: input.usedFallback ? `meta:whatsapp:${correlationRef}` : null,
    correlationId: `meta:whatsapp:${correlationRef}`,
    environment: process.env.NODE_ENV ?? "development",
    ruleVersion: USAGE_RULE_VERSION,
    metadata: {
      transport: "whatsapp_cloud_api",
      messageType: input.messageType,
      outboundRole: input.role,
      usedFallback: input.usedFallback,
      pricingState: "unpriced_pending_provider_reconciliation",
    },
    occurredAt: input.occurredAt ?? new Date(),
  });
}
