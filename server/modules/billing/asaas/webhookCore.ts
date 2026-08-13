import crypto from "node:crypto";
import type { Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  isDuplicateEntryError,
  requireDb,
  resultRows,
} from "../../../repositories/billingRepositorySupport";
import { sanitizeBillingProviderEventMetadata } from "../providerEvents";
import {
  billingSubscriptionLifecycleRepository,
  billingSubscriptionLifecycleService,
} from "../subscriptionLifecycleRuntime";
import type {
  BillingProviderNeutralFinancialFact,
  TrialIdentityInput,
} from "../subscriptionLifecycleTypes";
import type { AsaasAdapter, AsaasPaymentResponse } from "./adapter";
import type { AsaasOperation, AsaasOperationStore } from "./operationStore";

export type AsaasWebhookEnvelope = {
  id?: unknown;
  event?: unknown;
  dateCreated?: unknown;
  checkout?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  authorization?: Record<string, unknown>;
  paymentInstruction?: Record<string, unknown>;
};

type NormalizedAsaasWebhook = {
  providerEventId: string;
  eventType: string;
  occurredAt: Date | null;
  metadata: ReturnType<typeof sanitizeBillingProviderEventMetadata>;
};

export type PersistedWebhookRow = {
  id: string;
  providerEventId: string;
  eventType: string;
  subscriptionId: string | null;
  occurredAt: Date | null;
  metadata: Record<string, unknown>;
};

function safeEqual(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function authenticateAsaasWebhook(
  headers: Record<string, string | string[] | undefined>,
  expectedToken: string
) {
  const token = headers["asaas-access-token"];
  const actual = Array.isArray(token) ? (token[0] ?? "") : (token ?? "");
  return !!expectedToken && !!actual && safeEqual(actual, expectedToken);
}

function parseEnvelope(rawBody: Uint8Array): AsaasWebhookEnvelope {
  if (rawBody.byteLength === 0 || rawBody.byteLength > 128 * 1024) {
    throw new Error("asaas_webhook_invalid_size");
  }
  const parsed = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("asaas_webhook_invalid_body");
  }
  return parsed as AsaasWebhookEnvelope;
}

function stringValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  return null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown) {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  const string = stringValue(value);
  if (!string) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(string)
    ? `${string.replace(" ", "T")}-03:00`
    : string;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventObject(envelope: AsaasWebhookEnvelope) {
  return (
    envelope.payment ??
    envelope.subscription ??
    envelope.checkout ??
    envelope.authorization ??
    envelope.paymentInstruction ??
    {}
  );
}

function authorizationReference(envelope: AsaasWebhookEnvelope) {
  const instructionAuthorization = envelope.paymentInstruction?.authorization;
  return (
    stringValue(envelope.payment?.pixAutomaticAuthorizationId) ??
    stringValue(envelope.payment?.pixAutomaticAuthorization) ??
    stringValue(envelope.authorization?.id) ??
    stringValue(envelope.paymentInstruction?.pixAutomaticAuthorizationId) ??
    stringValue(instructionAuthorization)
  );
}

function subscriptionReference(envelope: AsaasWebhookEnvelope) {
  return (
    stringValue(envelope.subscription?.id) ??
    stringValue(envelope.payment?.subscription)
  );
}

function contractReference(envelope: AsaasWebhookEnvelope) {
  return (
    stringValue(envelope.subscription?.externalReference) ??
    stringValue(envelope.checkout?.externalReference) ??
    stringValue(envelope.payment?.externalReference) ??
    stringValue(envelope.authorization?.contractId)
  );
}

function customerReference(envelope: AsaasWebhookEnvelope) {
  return (
    stringValue(envelope.subscription?.customer) ??
    stringValue(envelope.payment?.customer) ??
    stringValue(envelope.authorization?.customerId) ??
    stringValue(envelope.authorization?.customer)
  );
}

function publicReference(envelope: AsaasWebhookEnvelope) {
  const immediateQrCode = envelope.authorization?.immediateQrCode;
  const authorizationConciliation =
    immediateQrCode &&
    typeof immediateQrCode === "object" &&
    !Array.isArray(immediateQrCode)
      ? stringValue(
          (immediateQrCode as Record<string, unknown>).conciliationIdentifier
        )
      : null;
  return (
    stringValue(envelope.payment?.conciliationIdentifier) ??
    authorizationConciliation
  );
}

function chargePurpose(externalReference: string | null) {
  if (!externalReference) return null;
  if (externalReference.includes(":early_conversion"))
    return "early_conversion";
  return null;
}

export function normalizeAsaasWebhookEnvelope(
  envelope: AsaasWebhookEnvelope
): NormalizedAsaasWebhook {
  const providerEventId = stringValue(envelope.id);
  const eventType = stringValue(envelope.event);
  if (!providerEventId || !eventType) {
    throw new Error("asaas_webhook_missing_identity");
  }
  const object = eventObject(envelope);
  const contract = contractReference(envelope);
  const amount = numberValue(envelope.payment?.value);
  return {
    providerEventId,
    eventType,
    occurredAt: dateValue(envelope.dateCreated),
    metadata: sanitizeBillingProviderEventMetadata({
      objectId: stringValue(object.id),
      status: stringValue(object.status),
      currency: stringValue(envelope.payment?.currency) ?? "BRL",
      amountMinor: amount === null ? null : Math.round(amount * 100),
      contractReference: contract,
      subscriptionReference: subscriptionReference(envelope),
      customerReference: customerReference(envelope),
      authorizationReference: authorizationReference(envelope),
      publicReference: publicReference(envelope),
      dueDate:
        stringValue(envelope.payment?.dueDate) ??
        stringValue(envelope.paymentInstruction?.dueDate),
      chargePurpose: chargePurpose(contract),
      providerCreatedAt: stringValue(envelope.dateCreated),
    }),
  };
}

function metadataFromDb(value: unknown) {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function metaString(metadata: Record<string, unknown>, key: string) {
  return stringValue(metadata[key]);
}

async function persistWebhook(normalized: NormalizedAsaasWebhook) {
  const db = await requireDb(getDb);
  const id = crypto.randomUUID();
  try {
    await db.execute(sql`
      INSERT INTO billingProviderEvents (
        id, provider, providerEventId, eventType, status, subscriptionId,
        occurredAt, payloadJson, createdAt, updatedAt
      ) VALUES (
        ${id}, 'asaas', ${normalized.providerEventId}, ${normalized.eventType},
        'received', NULL, ${normalized.occurredAt},
        ${normalized.metadata ? JSON.stringify(normalized.metadata) : null},
        NOW(), NOW()
      )
    `);
    return { id, created: true };
  } catch (error) {
    if (!isDuplicateEntryError(error)) throw error;
    const [existing] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id FROM billingProviderEvents
        WHERE provider = 'asaas'
          AND providerEventId = ${normalized.providerEventId}
        LIMIT 1
      `)
    );
    if (!existing) throw error;
    return { id: String(existing.id), created: false };
  }
}

export function financialKind(
  event: string
): BillingProviderNeutralFinancialFact["kind"] | null {
  switch (event) {
    case "PAYMENT_AUTHORIZED":
      return "authorization_confirmed";
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      return "payment_confirmed";
    case "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED":
      return "payment_refused";
    case "PAYMENT_OVERDUE":
    case "PAYMENT_REPROVED_BY_RISK_ANALYSIS":
      return "payment_failed";
    case "PAYMENT_CHARGEBACK_REQUESTED":
    case "PAYMENT_CHARGEBACK_DISPUTE":
    case "PAYMENT_REFUNDED":
      return "chargeback_confirmed";
    default:
      return null;
  }
}

export function financialKindFromPaymentStatus(
  status: unknown
): BillingProviderNeutralFinancialFact["kind"] | null {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  if (["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(normalized)) {
    return "payment_confirmed";
  }
  if (normalized === "OVERDUE") return "payment_failed";
  if (normalized === "REFUNDED" || normalized === "CHARGEBACK") {
    return "chargeback_confirmed";
  }
  return null;
}

export function authoritativePaymentOccurredAt(payment: AsaasPaymentResponse) {
  const raw =
    payment.paymentDate ?? payment.confirmedDate ?? payment.clientPaymentDate;
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return dateValue(`${raw}T12:00:00.000Z`);
  }
  return dateValue(raw);
}

export function isPixAuthorizationActivated(eventType: string) {
  return (
    eventType === "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED" ||
    eventType === "PIX_AUTOMATIC_AUTHORIZATION_ACTIVATED"
  );
}

export function isPixAuthorizationTerminal(eventType: string) {
  return (
    eventType === "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED" ||
    eventType === "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELED" ||
    eventType === "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED" ||
    eventType === "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED" ||
    eventType === "PIX_AUTOMATIC_AUTHORIZATION_CANCELLED" ||
    eventType === "PIX_AUTOMATIC_AUTHORIZATION_CANCELED" ||
    eventType === "PIX_AUTOMATIC_AUTHORIZATION_EXPIRED" ||
    eventType === "PIX_AUTOMATIC_AUTHORIZATION_REFUSED"
  );
}

function isKnownNonFinancialEvent(eventType: string) {
  return (
    eventType.startsWith("SUBSCRIPTION_") ||
    eventType.startsWith("CHECKOUT_") ||
    eventType.startsWith("PIX_AUTOMATIC_")
  );
}

function digits(value: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function trialIdentity(
  payerUserId: number,
  customer: Awaited<ReturnType<AsaasAdapter["getCustomer"]>>
): TrialIdentityInput {
  const document = digits(customer.cpfCnpj ?? null);
  const phone = digits(customer.mobilePhone ?? customer.phone ?? null);
  const identity: TrialIdentityInput = { userId: payerUserId, phone };
  if (document.length === 11) identity.cpf = document;
  if (document.length === 14) identity.cnpj = document;
  return identity;
}

function nextCycleDate(dueDate: string, billingCycle: "monthly" | "yearly") {
  const parts = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) throw new Error("asaas_payment_due_date_required");
  const year = Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  const targetMonth = billingCycle === "monthly" ? month + 1 : month;
  const targetYear = billingCycle === "yearly" ? year + 1 : year;
  const normalizedYear = targetYear + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(normalizedYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  const result = new Date(
    Date.UTC(normalizedYear, normalizedMonth, Math.min(day, lastDay), 12)
  );
  return result.toISOString().slice(0, 10);
}

export function createAsaasWebhookRuntime(input: {
  webhookToken: string;
  adapter: AsaasAdapter;
  store: AsaasOperationStore;
  beforeProcessEvent?: (row: PersistedWebhookRow) => Promise<void>;
}) {
  async function dbRow(id: string): Promise<PersistedWebhookRow | null> {
    const db = await requireDb(getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id, providerEventId, eventType, subscriptionId, occurredAt, payloadJson
        FROM billingProviderEvents
        WHERE id = ${id} AND provider = 'asaas'
        LIMIT 1
      `)
    );
    if (!row) return null;
    return {
      id: String(row.id),
      providerEventId: String(row.providerEventId),
      eventType: String(row.eventType),
      subscriptionId: row.subscriptionId ? String(row.subscriptionId) : null,
      occurredAt: dateValue(row.occurredAt) ?? null,
      metadata: metadataFromDb(row.payloadJson),
    };
  }

  async function markEvent(
    id: string,
    status: "processed" | "ignored" | "failed",
    errorCode: string | null,
    subscriptionId?: string | null
  ) {
    const db = await requireDb(getDb);
    await db.execute(sql`
      UPDATE billingProviderEvents
      SET status = ${status}, errorCode = ${errorCode},
        subscriptionId = COALESCE(${subscriptionId ?? null}, subscriptionId),
        processedAt = ${status === "failed" ? null : new Date()}, updatedAt = NOW()
      WHERE id = ${id}
    `);
  }

  async function loadContractSubscription(contractKey: string) {
    const db = await requireDb(getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT subscriptionId FROM billingContractIntents
        WHERE provider = 'asaas' AND contractKey = ${contractKey}
        LIMIT 1
      `)
    );
    return row ? String(row.subscriptionId) : null;
  }

  async function loadExternalSubscription(externalSubscriptionId: string) {
    const db = await requireDb(getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id FROM billingSubscriptions
        WHERE provider = 'asaas'
          AND externalSubscriptionId = ${externalSubscriptionId}
        LIMIT 1
      `)
    );
    return row ? String(row.id) : null;
  }

  async function loadContractKey(subscriptionId: string) {
    const db = await requireDb(getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT contractKey FROM billingContractIntents
        WHERE subscriptionId = ${subscriptionId}
        ORDER BY createdAt DESC LIMIT 1
      `)
    );
    return row ? String(row.contractKey) : null;
  }

  async function bindExternalSubscription(inputBind: {
    subscriptionId: string;
    externalSubscriptionId: string;
    customerReference?: string | null;
  }) {
    const db = await requireDb(getDb);
    await db.execute(sql`
      UPDATE billingSubscriptions
      SET externalSubscriptionId = COALESCE(externalSubscriptionId, ${inputBind.externalSubscriptionId}),
        externalCustomerId = COALESCE(externalCustomerId, ${inputBind.customerReference ?? null}),
        updatedAt = NOW()
      WHERE id = ${inputBind.subscriptionId}
        AND provider = 'asaas'
        AND (externalSubscriptionId IS NULL OR externalSubscriptionId = ${inputBind.externalSubscriptionId})
        AND (
          ${inputBind.customerReference ?? null} IS NULL
          OR externalCustomerId IS NULL
          OR externalCustomerId = ${inputBind.customerReference ?? null}
        )
    `);
    const [bound] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT externalSubscriptionId, externalCustomerId
        FROM billingSubscriptions
        WHERE id = ${inputBind.subscriptionId} AND provider = 'asaas'
        LIMIT 1
      `)
    );
    if (
      !bound ||
      String(bound.externalSubscriptionId ?? "") !==
        inputBind.externalSubscriptionId ||
      (inputBind.customerReference &&
        String(bound.externalCustomerId ?? "") !== inputBind.customerReference)
    ) {
      throw new Error("asaas_subscription_correlation_conflict");
    }
  }

  async function cancelRejectedTrial(externalSubscriptionId: string) {
    const operationKey = `trial-reject-cancel:${externalSubscriptionId}`;
    const prepared = await input.store.prepare({
      kind: "reconciliation",
      operationKey,
      externalReference: externalSubscriptionId,
    });
    if (prepared.operation.state === "created") return;
    if (prepared.operation.state === "outcome_unknown") {
      const synchronized = await input.adapter.provider.synchronizeSubscription(
        externalSubscriptionId
      );
      if (
        synchronized.status === "canceled" ||
        synchronized.status === "expired"
      ) {
        await input.store.markCreated({
          kind: "reconciliation",
          operationKey,
          externalId: externalSubscriptionId,
          externalReference: externalSubscriptionId,
        });
        return;
      }
      throw new Error("asaas_trial_rejection_cancel_reconciliation_pending");
    }
    if (!prepared.created && prepared.operation.state === "failed") {
      throw new Error("asaas_trial_rejection_cancel_failed");
    }
    try {
      await input.adapter.provider.cancelSubscription(externalSubscriptionId);
      await input.store.markCreated({
        kind: "reconciliation",
        operationKey,
        externalId: externalSubscriptionId,
        externalReference: externalSubscriptionId,
      });
    } catch (error) {
      const uncertain =
        error instanceof Error && error.name === "AsaasUncertainOutcomeError";
      if (uncertain) {
        await input.store.markOutcomeUnknown("reconciliation", operationKey);
      } else {
        await input.store.markFailed(
          "reconciliation",
          operationKey,
          "trial_rejection_cancel_failed"
        );
      }
      throw error;
    }
  }

  async function correlateSubscriptionCreated(inputCorrelation: {
    providerEventId: string;
    contractKey: string;
    externalSubscriptionId: string;
    customerReference: string | null;
    occurredAt: Date;
  }): Promise<{ subscriptionId: string | null; permanentReason?: string }> {
    let subscriptionId = await loadContractSubscription(
      inputCorrelation.contractKey
    );
    const operationKey = `${inputCorrelation.contractKey}:checkout`;
    const checkout = await input.store.get("checkout", operationKey);

    if (!subscriptionId && checkout?.subscriptionId) {
      subscriptionId = checkout.subscriptionId;
    }

    if (checkout?.payerUserId && inputCorrelation.customerReference) {
      await input.adapter.rememberHostedCheckoutCustomer(
        checkout.payerUserId,
        inputCorrelation.customerReference
      );
    }

    if (!subscriptionId && checkout?.trialChoice === "request") {
      if (
        !checkout.payerUserId ||
        !checkout.planCode ||
        checkout.paymentMethod !== "credit_card" ||
        !inputCorrelation.customerReference
      ) {
        return { subscriptionId: null };
      }
      const customer = await input.adapter.getCustomer(
        inputCorrelation.customerReference
      );
      let prepared: Awaited<
        ReturnType<typeof billingSubscriptionLifecycleService.startContract>
      >;
      try {
        prepared = await billingSubscriptionLifecycleService.startContract({
          contractKey: inputCorrelation.contractKey,
          providerCode: "asaas",
          payerUserId: checkout.payerUserId,
          versionCode: checkout.planCode,
          paymentMethod: "credit_card",
          trialChoice: "request",
          verifiedPaymentInstrument: {
            payerUserId: checkout.payerUserId,
            providerCode: "asaas",
            paymentMethod: "credit_card",
            registrationId: inputCorrelation.externalSubscriptionId,
            verifiedAt: inputCorrelation.occurredAt,
          },
          identity: trialIdentity(checkout.payerUserId, customer),
          couponCode: checkout.couponCode,
          correlationId:
            checkout.correlationId ??
            `asaas:${inputCorrelation.providerEventId}`,
          transitionAccessUntil: checkout.transitionAccessUntil,
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (
          code.includes("trial_identity") ||
          code === "billing_trial_registered_card_required" ||
          code === "billing_payment_method_not_allowed" ||
          code === "billing_plan_not_available"
        ) {
          await cancelRejectedTrial(inputCorrelation.externalSubscriptionId);
          return {
            subscriptionId: null,
            permanentReason: code || "trial_invalid",
          };
        }
        throw error;
      }
      if (!prepared.ok) {
        await cancelRejectedTrial(inputCorrelation.externalSubscriptionId);
        return {
          subscriptionId: null,
          permanentReason: `trial_${prepared.reason}`,
        };
      }
      subscriptionId = prepared.intent.subscriptionId;
      await input.store.bindSubscription(
        "checkout",
        operationKey,
        subscriptionId
      );
    }

    if (subscriptionId) {
      await bindExternalSubscription({
        subscriptionId,
        externalSubscriptionId: inputCorrelation.externalSubscriptionId,
        customerReference: inputCorrelation.customerReference,
      });
      if (checkout && !checkout.subscriptionId) {
        await input.store.bindSubscription(
          "checkout",
          operationKey,
          subscriptionId
        );
      }
    }
    return { subscriptionId };
  }

  async function resolveSubscription(row: PersistedWebhookRow) {
    if (row.subscriptionId) return row.subscriptionId;
    const externalSubscriptionId = metaString(
      row.metadata,
      "subscriptionReference"
    );
    if (externalSubscriptionId) {
      const local = await loadExternalSubscription(externalSubscriptionId);
      if (local) return local;
    }

    const objectId = metaString(row.metadata, "objectId");
    if (objectId && row.eventType.startsWith("PAYMENT_")) {
      const scheduled = await input.store.findByExternalId(
        "pix_payment",
        objectId
      );
      if (scheduled?.subscriptionId) return scheduled.subscriptionId;
    }

    const authorizationId = metaString(row.metadata, "authorizationReference");
    if (authorizationId) {
      const authorization = await input.store.findByExternalId(
        "pix_automatic_authorization",
        authorizationId
      );
      if (authorization?.subscriptionId) return authorization.subscriptionId;
    }

    const contract = metaString(row.metadata, "contractReference");
    if (contract) {
      const pixByContractId = await input.store.findByPublicReference(
        "pix_automatic_authorization",
        contract
      );
      if (pixByContractId?.subscriptionId)
        return pixByContractId.subscriptionId;
    }

    if (contract) {
      const exact = await loadContractSubscription(contract);
      if (exact) return exact;
    }
    return null;
  }

  async function financialOperationContext(
    row: PersistedWebhookRow,
    subscriptionId: string
  ): Promise<AsaasOperation | null> {
    const authorizationId = metaString(row.metadata, "authorizationReference");
    if (authorizationId) {
      const authorization = await input.store.findByExternalId(
        "pix_automatic_authorization",
        authorizationId
      );
      if (authorization) return authorization;
    }
    const contractKey = await loadContractKey(subscriptionId);
    return contractKey
      ? input.store.get("checkout", `${contractKey}:checkout`)
      : null;
  }

  async function recordCouponCharge(
    subscriptionId: string,
    paymentId: string,
    operation: AsaasOperation
  ) {
    if (!operation.couponCode || !operation.discountDurationCharges) return 0;
    const key = `${subscriptionId}:${paymentId}`;
    const prepared = await input.store.prepare({
      kind: "coupon_charge",
      operationKey: key,
      subscriptionId,
      externalReference: operation.externalReference,
      couponCode: operation.couponCode,
      amountMinor: operation.amountMinor,
      unitAmountMinor: operation.unitAmountMinor,
      discountDurationCharges: operation.discountDurationCharges,
    });
    if (prepared.operation.state !== "created") {
      await input.store.markCreated({
        kind: "coupon_charge",
        operationKey: key,
        externalId: paymentId,
        externalReference: operation.externalReference,
      });
    }
    return input.store.countCouponCharges(subscriptionId);
  }

  async function postPaymentBookkeeping(
    row: PersistedWebhookRow,
    subscriptionId: string
  ) {
    const paymentId = metaString(row.metadata, "objectId");
    if (!paymentId) return;
    const operation = await financialOperationContext(row, subscriptionId);
    if (!operation) return;
    const confirmedCouponCharges = await recordCouponCharge(
      subscriptionId,
      paymentId,
      operation
    );

    if (
      operation.kind === "checkout" &&
      operation.discountDurationCharges &&
      operation.unitAmountMinor &&
      operation.externalReference &&
      confirmedCouponCharges >= operation.discountDurationCharges
    ) {
      const externalSubscriptionId = metaString(
        row.metadata,
        "subscriptionReference"
      );
      if (externalSubscriptionId) {
        await input.adapter.restoreSubscriptionBaseAmount({
          subscriptionId,
          externalSubscriptionId,
          contractKey: operation.externalReference,
          unitAmountMinor: operation.unitAmountMinor,
        });
      }
    }

    if (
      operation.kind === "pix_automatic_authorization" &&
      operation.externalId &&
      operation.customerReference &&
      operation.externalReference &&
      operation.billingCycle &&
      operation.billingCycle !== "custom"
    ) {
      const currentDueDate = metaString(row.metadata, "dueDate");
      if (!currentDueDate) return;
      const nextDueDate = nextCycleDate(currentDueDate, operation.billingCycle);
      const nextAmount =
        operation.discountDurationCharges &&
        operation.amountMinor &&
        operation.unitAmountMinor &&
        confirmedCouponCharges < operation.discountDurationCharges
          ? operation.amountMinor
          : (operation.unitAmountMinor ?? operation.amountMinor);
      if (!nextAmount) return;
      await input.adapter.schedulePixPayment({
        subscriptionId,
        contractKey: operation.externalReference,
        authorizationId: operation.externalId,
        customerId: operation.customerReference,
        competenceKey: nextDueDate,
        dueDate: nextDueDate,
        amountMinor: nextAmount,
      });
    }
  }

  async function processEvent(id: string) {
    const row = await dbRow(id);
    if (!row) return "missing" as const;
    try {
      await input.beforeProcessEvent?.(row);

      if (row.eventType.startsWith("CHECKOUT_")) {
        const contractKey = metaString(row.metadata, "contractReference");
        const checkoutId = metaString(row.metadata, "objectId");
        if (contractKey && checkoutId) {
          const operationKey = `${contractKey}:checkout`;
          const checkout = await input.store.get("checkout", operationKey);
          if (checkout && checkout.state !== "created") {
            await input.store.markCreated({
              kind: "checkout",
              operationKey,
              externalId: checkoutId,
              externalReference: contractKey,
              customerReference: checkout.customerReference,
            });
          }
        }
      }

      if (
        row.eventType === "CHECKOUT_EXPIRED" ||
        row.eventType === "CHECKOUT_CANCELED" ||
        row.eventType === "CHECKOUT_CANCELLED"
      ) {
        const contractKey = metaString(row.metadata, "contractReference");
        if (!contractKey) {
          await markEvent(row.id, "failed", "correlation_pending");
          return "retry" as const;
        }
        const operationKey = `${contractKey}:checkout`;
        const checkout = await input.store.get("checkout", operationKey);
        const subscriptionId =
          checkout?.subscriptionId ??
          (await loadContractSubscription(contractKey));
        if (subscriptionId) {
          await billingSubscriptionLifecycleService.applyFinancialFact({
            providerCode: "asaas",
            providerEventId: row.providerEventId,
            subscriptionId,
            kind: "attempt_expired",
            occurredAt: row.occurredAt ?? new Date(),
            competenceKey:
              metaString(row.metadata, "objectId") ?? row.providerEventId,
            correlationId: `asaas:${row.providerEventId}`,
          });
        } else if (checkout?.couponCode) {
          await billingSubscriptionLifecycleRepository.cancelCouponReservation(
            contractKey
          );
        }
        if (checkout) {
          await input.store.markFailed(
            "checkout",
            operationKey,
            "checkout_expired"
          );
        }
        await markEvent(row.id, "processed", null, subscriptionId);
        return "processed" as const;
      }

      if (row.eventType.startsWith("PIX_AUTOMATIC_")) {
        const authorizationId =
          metaString(row.metadata, "authorizationReference") ??
          metaString(row.metadata, "objectId");
        const contractId = metaString(row.metadata, "contractReference");
        if (authorizationId && contractId) {
          const authorization = await input.store.findByPublicReference(
            "pix_automatic_authorization",
            contractId
          );
          if (authorization && authorization.state !== "created") {
            await input.store.markCreated({
              kind: "pix_automatic_authorization",
              operationKey: authorization.operationKey,
              externalId: authorizationId,
              externalReference: authorization.externalReference,
              customerReference:
                metaString(row.metadata, "customerReference") ??
                authorization.customerReference,
              authorizationReference: authorizationId,
              publicReference: contractId,
            });
          }
        }
      }

      if (isPixAuthorizationTerminal(row.eventType)) {
        const authorizationId =
          metaString(row.metadata, "authorizationReference") ??
          metaString(row.metadata, "objectId");
        const contractId = metaString(row.metadata, "contractReference");
        let authorization = authorizationId
          ? await input.store.findByExternalId(
              "pix_automatic_authorization",
              authorizationId
            )
          : null;
        if (!authorization && contractId) {
          authorization = await input.store.findByPublicReference(
            "pix_automatic_authorization",
            contractId
          );
        }
        if (!authorization) {
          await markEvent(row.id, "failed", "correlation_pending");
          return "retry" as const;
        }
        const subscriptionId =
          authorization.subscriptionId ?? (await resolveSubscription(row));
        if (subscriptionId) {
          await billingSubscriptionLifecycleService.applyFinancialFact({
            providerCode: "asaas",
            providerEventId: row.providerEventId,
            subscriptionId,
            kind: "attempt_expired",
            occurredAt: row.occurredAt ?? new Date(),
            competenceKey: authorizationId ?? row.providerEventId,
            correlationId: `asaas:${row.providerEventId}`,
          });
        }
        if (authorization.externalReference) {
          await billingSubscriptionLifecycleRepository.cancelCouponReservation(
            authorization.externalReference
          );
        }
        await input.store.markFailed(
          "pix_automatic_authorization",
          authorization.operationKey,
          "authorization_closed"
        );
        await markEvent(row.id, "processed", null, subscriptionId);
        return "processed" as const;
      }

      if (isPixAuthorizationActivated(row.eventType)) {
        const authorizationId =
          metaString(row.metadata, "authorizationReference") ??
          metaString(row.metadata, "objectId");
        if (!authorizationId) {
          await markEvent(row.id, "failed", "correlation_pending");
          return "retry" as const;
        }
        const key = `pix-authorization-active:${authorizationId}`;
        const prepared = await input.store.prepare({
          kind: "reconciliation",
          operationKey: key,
          authorizationReference: authorizationId,
        });
        if (prepared.operation.state !== "created") {
          await input.store.markCreated({
            kind: "reconciliation",
            operationKey: key,
            externalId: authorizationId,
            authorizationReference: authorizationId,
          });
        }
        await markEvent(row.id, "processed", null);
        return "processed" as const;
      }

      if (row.eventType === "SUBSCRIPTION_CREATED") {
        const contractKey = metaString(row.metadata, "contractReference");
        const externalSubscriptionId =
          metaString(row.metadata, "subscriptionReference") ??
          metaString(row.metadata, "objectId");
        if (!contractKey || !externalSubscriptionId) {
          await markEvent(row.id, "failed", "correlation_pending");
          return "retry" as const;
        }
        const correlated = await correlateSubscriptionCreated({
          providerEventId: row.providerEventId,
          contractKey,
          externalSubscriptionId,
          customerReference: metaString(row.metadata, "customerReference"),
          occurredAt: row.occurredAt ?? new Date(),
        });
        if (correlated.permanentReason) {
          await markEvent(
            row.id,
            "processed",
            correlated.permanentReason,
            correlated.subscriptionId
          );
          return "processed" as const;
        }
        if (!correlated.subscriptionId) {
          await markEvent(row.id, "failed", "correlation_pending");
          return "retry" as const;
        }
        await markEvent(row.id, "processed", null, correlated.subscriptionId);
        return "processed" as const;
      }

      const kind = financialKind(row.eventType);
      if (kind) {
        const subscriptionId = await resolveSubscription(row);
        if (!subscriptionId) {
          await markEvent(row.id, "failed", "correlation_pending");
          return "retry" as const;
        }
        const paymentId = metaString(row.metadata, "objectId");
        await billingSubscriptionLifecycleService.applyFinancialFact({
          providerCode: "asaas",
          providerEventId: row.providerEventId,
          subscriptionId,
          kind,
          occurredAt: row.occurredAt ?? new Date(),
          competenceKey: paymentId ?? row.providerEventId,
          chargePurpose:
            (metaString(row.metadata, "chargePurpose") as
              | "initial"
              | "early_conversion"
              | "renewal"
              | "recovery"
              | null) ?? "renewal",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          commercialConfirmationKey: null,
          correlationId: `asaas:${row.providerEventId}`,
        });
        if (kind === "payment_confirmed") {
          await postPaymentBookkeeping(row, subscriptionId);
        }
        await markEvent(row.id, "processed", null, subscriptionId);
        return "processed" as const;
      }

      if (isKnownNonFinancialEvent(row.eventType)) {
        const subscriptionId = await resolveSubscription(row);
        await markEvent(row.id, "processed", null, subscriptionId);
        return "processed" as const;
      }

      await markEvent(row.id, "ignored", "unknown_event");
      return "ignored" as const;
    } catch (error) {
      await markEvent(
        row.id,
        "failed",
        error instanceof Error &&
          error.message === "billing_subscription_not_found"
          ? "correlation_pending"
          : "processing_failed"
      );
      throw error;
    }
  }

  async function processDueEvents(limit = 100) {
    const db = await requireDb(getDb);
    const rows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id FROM billingProviderEvents
        WHERE provider = 'asaas'
          AND providerEventId NOT LIKE 'local:%'
          AND (
            status = 'received'
            OR (status = 'failed' AND errorCode IN ('correlation_pending', 'processing_failed'))
          )
        ORDER BY createdAt ASC
        LIMIT ${Math.max(1, Math.min(500, limit))}
      `)
    );
    let processed = 0;
    for (const row of rows) {
      try {
        await processEvent(String(row.id));
        processed += 1;
      } catch (error) {
        console.warn("[Billing/Asaas] durable webhook processing failed", {
          eventId: String(row.id),
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    return processed;
  }

  async function reconcileSubscriptionCreated(inputReconcile: {
    contractKey: string;
    externalSubscriptionId: string;
    customerReference: string | null;
  }) {
    return correlateSubscriptionCreated({
      providerEventId: `manual:${crypto.randomUUID()}`,
      contractKey: inputReconcile.contractKey,
      externalSubscriptionId: inputReconcile.externalSubscriptionId,
      customerReference: inputReconcile.customerReference,
      occurredAt: new Date(),
    });
  }

  async function reconcileFinancialPayment(inputReconcile: {
    subscriptionId: string;
    externalSubscriptionId: string;
    payment: AsaasPaymentResponse;
  }) {
    const paymentId = stringValue(inputReconcile.payment.id);
    const paymentSubscription = stringValue(
      inputReconcile.payment.subscription
    );
    const status = String(inputReconcile.payment.status ?? "")
      .trim()
      .toUpperCase();
    if (
      !paymentId ||
      paymentSubscription !== inputReconcile.externalSubscriptionId
    ) {
      throw new Error("asaas_payment_reconciliation_identity_mismatch");
    }
    const kind = financialKindFromPaymentStatus(status);
    if (!kind) return { processed: false as const, status };
    const occurredAt = authoritativePaymentOccurredAt(inputReconcile.payment);
    if (!occurredAt) {
      return {
        processed: false as const,
        status,
        reason: "authoritative_timestamp_missing" as const,
      };
    }
    const providerEventId = `reconciliation:payment:${paymentId}:${status.toLowerCase()}`;
    const row: PersistedWebhookRow = {
      id: providerEventId,
      providerEventId,
      eventType: `RECONCILIATION_PAYMENT_${status}`,
      subscriptionId: inputReconcile.subscriptionId,
      occurredAt,
      metadata: {
        objectId: paymentId,
        status,
        subscriptionReference: inputReconcile.externalSubscriptionId,
        customerReference: inputReconcile.payment.customer ?? null,
        contractReference: inputReconcile.payment.externalReference ?? null,
        dueDate: inputReconcile.payment.dueDate ?? null,
        chargePurpose: "initial",
      },
    };
    const applied =
      await billingSubscriptionLifecycleService.applyFinancialFact({
        providerCode: "asaas",
        providerEventId,
        subscriptionId: inputReconcile.subscriptionId,
        kind,
        occurredAt,
        competenceKey: paymentId,
        chargePurpose:
          (metaString(row.metadata, "chargePurpose") as
            | "initial"
            | "early_conversion"
            | "renewal"
            | "recovery"
            | null) ?? "renewal",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        commercialConfirmationKey: null,
        correlationId: `asaas:${providerEventId}`,
      });
    if (kind === "payment_confirmed") {
      await postPaymentBookkeeping(row, inputReconcile.subscriptionId);
    }
    return { processed: true as const, status, kind, ...applied };
  }

  async function handle(req: Request, res: Response) {
    if (
      !authenticateAsaasWebhook(
        req.headers as Record<string, string | string[] | undefined>,
        input.webhookToken
      )
    ) {
      res.status(401).json({ ok: false });
      return;
    }
    try {
      const raw = Buffer.isBuffer(req.body)
        ? new Uint8Array(req.body)
        : req.body instanceof Uint8Array
          ? req.body
          : new Uint8Array();
      const normalized = normalizeAsaasWebhookEnvelope(parseEnvelope(raw));
      const persisted = await persistWebhook(normalized);
      res.status(200).json({ ok: true, duplicate: !persisted.created });
      if (persisted.created) {
        setImmediate(() => {
          void processEvent(persisted.id).catch(error => {
            console.warn("[Billing/Asaas] webhook queued for reconciliation", {
              providerEventId: normalized.providerEventId,
              error: error instanceof Error ? error.name : "unknown",
            });
          });
        });
      }
    } catch (error) {
      console.warn("[Billing/Asaas] webhook rejected", {
        error: error instanceof Error ? error.message : "unknown",
      });
      res.status(400).json({ ok: false });
    }
  }

  return {
    handle,
    processEvent,
    processDueEvents,
    reconcileSubscriptionCreated,
    reconcileFinancialPayment,
  };
}
