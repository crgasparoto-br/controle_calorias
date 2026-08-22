import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";
import type { BillingPaymentMethod } from "./catalogPolicy";
import type { BillingTrialChoice } from "./subscriptionLifecycleTypes";

export type BillingWebCheckoutAttemptSignature = {
  userId: number;
  versionCode: string;
  paymentMethod: BillingPaymentMethod;
  trialChoice: BillingTrialChoice;
  couponCode?: string | null;
  replaceExisting?: boolean;
};

export type StoredBillingWebCheckoutAttempt = {
  signatureHash: string;
  contractKey: string;
  versionCode: string;
  paymentMethod: BillingPaymentMethod;
  trialChoice: BillingTrialChoice;
  couponCode: string | null;
  generation: number;
  released: boolean;
};

type ProviderAttemptState = "prepared" | "created" | "outcome_unknown" | "failed" | null;

export type BillingWebCheckoutAttemptDecision =
  | {
      status: "claimed";
      contractKey: string;
      reused: boolean;
      generation: number;
      persist: boolean;
    }
  | {
      status: "conflict";
      contractKey: string;
      versionCode: string;
      paymentMethod: BillingPaymentMethod;
      trialChoice: BillingTrialChoice;
      couponCode: string | null;
    };

function normalizedCoupon(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized || null;
}

export function billingWebCheckoutSignatureHash(
  input: BillingWebCheckoutAttemptSignature
) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        input.userId,
        input.versionCode.trim(),
        input.paymentMethod,
        input.trialChoice,
        normalizedCoupon(input.couponCode),
      ])
    )
    .digest("hex");
}

function intentProviderEventId(userId: number) {
  return `checkout-intent:${crypto
    .createHash("sha256")
    .update(`payer:${userId}`)
    .digest("hex")}`;
}

function providerOperationEventId(
  paymentMethod: BillingPaymentMethod,
  contractKey: string
) {
  const kind =
    paymentMethod === "credit_card" ? "checkout" : "pix_automatic_authorization";
  const operationKey =
    paymentMethod === "credit_card"
      ? `${contractKey}:checkout`
      : `${contractKey}:pix-automatic`;
  return `local:${kind}:${crypto
    .createHash("sha256")
    .update(operationKey)
    .digest("hex")}`;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseStoredAttempt(value: unknown): StoredBillingWebCheckoutAttempt | null {
  const payload = jsonObject(value);
  const signatureHash = String(payload.signatureHash ?? "").trim();
  const contractKey = String(payload.contractKey ?? "").trim();
  const versionCode = String(payload.versionCode ?? "").trim();
  const paymentMethod = String(payload.paymentMethod ?? "") as BillingPaymentMethod;
  const trialChoice = String(payload.trialChoice ?? "") as BillingTrialChoice;
  const generation = Number(payload.generation ?? 0);
  if (
    !signatureHash ||
    !contractKey ||
    !versionCode ||
    (paymentMethod !== "credit_card" && paymentMethod !== "pix_automatic") ||
    (trialChoice !== "request" && trialChoice !== "waive") ||
    !Number.isInteger(generation) ||
    generation < 1
  ) {
    return null;
  }
  return {
    signatureHash,
    contractKey,
    versionCode,
    paymentMethod,
    trialChoice,
    couponCode: normalizedCoupon(
      typeof payload.couponCode === "string" ? payload.couponCode : null
    ),
    generation,
    released: payload.released === true,
  };
}

function storedAttemptPayload(
  input: BillingWebCheckoutAttemptSignature,
  signatureHash: string,
  contractKey: string,
  generation: number,
  released = false,
  releaseReason: string | null = null
) {
  return JSON.stringify({
    signatureHash,
    contractKey,
    versionCode: input.versionCode.trim(),
    paymentMethod: input.paymentMethod,
    trialChoice: input.trialChoice,
    couponCode: normalizedCoupon(input.couponCode),
    generation,
    released,
    releaseReason,
  });
}

export function decideBillingWebCheckoutAttempt(input: {
  incoming: BillingWebCheckoutAttemptSignature;
  existing: StoredBillingWebCheckoutAttempt | null;
  providerState: ProviderAttemptState;
  candidateContractKey: string;
}): BillingWebCheckoutAttemptDecision {
  const signatureHash = billingWebCheckoutSignatureHash(input.incoming);
  if (!input.existing) {
    return {
      status: "claimed",
      contractKey: input.candidateContractKey,
      reused: false,
      generation: 1,
      persist: true,
    };
  }

  const terminal =
    input.incoming.replaceExisting === true ||
    input.existing.released ||
    input.providerState === "failed";
  if (terminal) {
    return {
      status: "claimed",
      contractKey: input.candidateContractKey,
      reused: false,
      generation: input.existing.generation + 1,
      persist: true,
    };
  }

  if (input.existing.signatureHash === signatureHash) {
    return {
      status: "claimed",
      contractKey: input.existing.contractKey,
      reused: true,
      generation: input.existing.generation,
      persist: false,
    };
  }

  return {
    status: "conflict",
    contractKey: input.existing.contractKey,
    versionCode: input.existing.versionCode,
    paymentMethod: input.existing.paymentMethod,
    trialChoice: input.existing.trialChoice,
    couponCode: input.existing.couponCode,
  };
}

async function loadProviderAttemptState(
  tx: { execute(query: any): Promise<any> },
  attempt: StoredBillingWebCheckoutAttempt
): Promise<ProviderAttemptState> {
  const eventId = providerOperationEventId(
    attempt.paymentMethod,
    attempt.contractKey
  );
  const [row] = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')) AS providerState
      FROM billingProviderEvents
      WHERE provider = 'asaas'
        AND providerEventId = ${eventId}
      LIMIT 1
    `)
  );
  const state = String(row?.providerState ?? "").trim();
  return state === "prepared" ||
    state === "created" ||
    state === "outcome_unknown" ||
    state === "failed"
    ? state
    : null;
}

export async function claimBillingWebCheckoutAttempt(
  input: BillingWebCheckoutAttemptSignature
): Promise<BillingWebCheckoutAttemptDecision> {
  const db = await requireDb(getDb);
  const providerEventId = intentProviderEventId(input.userId);
  const signatureHash = billingWebCheckoutSignatureHash(input);
  const candidateContractKey = `web_${crypto.randomUUID().replaceAll("-", "")}`;

  return db.transaction(async tx => {
    const [payer] = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id
        FROM users
        WHERE id = ${input.userId}
        LIMIT 1
        FOR UPDATE
      `)
    );
    if (!payer) throw new Error("billing_checkout_payer_not_found");

    const [row] = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id, payloadJson
        FROM billingProviderEvents
        WHERE provider = 'billing-web'
          AND providerEventId = ${providerEventId}
        LIMIT 1
        FOR UPDATE
      `)
    );
    const existing = row ? parseStoredAttempt(row.payloadJson) : null;
    if (row && !existing) throw new Error("billing_checkout_attempt_state_invalid");
    const providerState = existing
      ? await loadProviderAttemptState(tx, existing)
      : null;
    const decision = decideBillingWebCheckoutAttempt({
      incoming: input,
      existing,
      providerState,
      candidateContractKey,
    });

    if (decision.status === "conflict" || !decision.persist) return decision;

    const payload = storedAttemptPayload(
      input,
      signatureHash,
      decision.contractKey,
      decision.generation
    );
    if (!row) {
      await tx.execute(sql`
        INSERT INTO billingProviderEvents (
          id, provider, providerEventId, eventType, status,
          subscriptionId, payloadJson, createdAt, updatedAt
        ) VALUES (
          ${crypto.randomUUID()}, 'billing-web', ${providerEventId},
          'checkout_intent', 'received', NULL, ${payload}, NOW(), NOW()
        )
      `);
    } else {
      await tx.execute(sql`
        UPDATE billingProviderEvents
        SET status = 'received', errorCode = NULL,
          payloadJson = ${payload}, updatedAt = NOW()
        WHERE id = ${String(row.id)}
      `);
    }
    return decision;
  });
}

export async function releaseBillingWebCheckoutAttempt(input: {
  userId: number;
  contractKey: string;
  reason: string;
}) {
  const db = await requireDb(getDb);
  const providerEventId = intentProviderEventId(input.userId);
  return db.transaction(async tx => {
    await tx.execute(sql`
      SELECT id FROM users WHERE id = ${input.userId} LIMIT 1 FOR UPDATE
    `);
    const [row] = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id, payloadJson
        FROM billingProviderEvents
        WHERE provider = 'billing-web'
          AND providerEventId = ${providerEventId}
        LIMIT 1
        FOR UPDATE
      `)
    );
    const current = row ? parseStoredAttempt(row.payloadJson) : null;
    if (!row || !current || current.contractKey !== input.contractKey) return false;
    const providerState = await loadProviderAttemptState(tx, current);
    if (providerState && providerState !== "failed") return false;
    const payload = storedAttemptPayload(
      {
        userId: input.userId,
        versionCode: current.versionCode,
        paymentMethod: current.paymentMethod,
        trialChoice: current.trialChoice,
        couponCode: current.couponCode,
      },
      current.signatureHash,
      current.contractKey,
      current.generation,
      true,
      input.reason.slice(0, 120)
    );
    await tx.execute(sql`
      UPDATE billingProviderEvents
      SET payloadJson = ${payload}, updatedAt = NOW()
      WHERE id = ${String(row.id)}
    `);
    return true;
  });
}
