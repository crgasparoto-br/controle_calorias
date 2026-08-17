import { sql } from "drizzle-orm";
import { normalizeCommercialPaymentMethods } from "../modules/billing/catalogPolicy";
import type {
  BillingEarlyConversionConfirmation,
  BillingPlanForLifecycle,
} from "../modules/billing/subscriptionLifecycleTypes";
import {
  dateOrNull,
  numberValue,
  requireDb,
  resultRows,
  stringArray,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

export type BillingDelinquencyContext = {
  competenceKey: string | null;
  periodStart: Date | null;
};

export type BillingExistingContractIntent = { payerUserId: number; trialChoice: "request" | "waive" };

export type BillingLifecycleRemediationReadModel = {
  loadContractIntent(contractKey: string): Promise<BillingExistingContractIntent | null>;
  hasHistoricalTransitionAccess(userId: number): Promise<boolean>;
  loadDelinquency(subscriptionId: string): Promise<BillingDelinquencyContext | null>;
  loadEarlyConversionConfirmation(
    subscriptionId: string
  ): Promise<BillingEarlyConversionConfirmation | null>;
  loadContractPlan(subscriptionId: string): Promise<BillingPlanForLifecycle | null>;
};

function parseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createBillingLifecycleRemediationReadModel(
  deps: BillingRepositoryDeps
): BillingLifecycleRemediationReadModel {
  async function loadContractIntent(contractKey: string) {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT payerUserId, trialChoice
        FROM billingContractIntents
        WHERE contractKey = ${contractKey}
        LIMIT 1
      `)
    );
    if (!row) return null;
    const trialChoice = row.trialChoice === "waive" ? "waive" : "request";
    return { payerUserId: numberValue(row.payerUserId), trialChoice } as const;
  }

  async function hasHistoricalTransitionAccess(userId: number) {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id
        FROM billingEntitlements
        WHERE beneficiaryUserId = ${userId}
          AND sourceType = 'transition'
        LIMIT 1
      `)
    );
    return !!row;
  }

  async function loadDelinquency(subscriptionId: string) {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT payloadJson
        FROM billingSubscriptionFacts
        WHERE subscriptionId = ${subscriptionId}
          AND factType = 'past_due_entered'
          AND invalidatedAt IS NULL
        ORDER BY effectiveAt DESC, createdAt DESC
        LIMIT 1
      `)
    );
    if (!row) return null;
    const payload = parseObject(row.payloadJson);
    if (!payload) return { competenceKey: null, periodStart: null };
    return {
      competenceKey: nonEmptyString(payload.competenceKey),
      periodStart: dateOrNull(payload.currentPeriodStart),
    };
  }

  async function loadContractPlan(subscriptionId: string) {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT p.id, pr.code AS productCode, p.versionCode, p.audience,
          p.billingCycle, p.currency, p.unitAmount, p.capacityLimit,
          p.entitlementsJson, p.commercialPaymentMethodsJson
        FROM billingSubscriptions s
        INNER JOIN billingPlans p ON p.id = s.planId
        INNER JOIN billingProducts pr ON pr.id = p.productId
        WHERE s.id = ${subscriptionId}
        LIMIT 1
      `)
    );
    if (!row) return null;
    return {
      id: String(row.id),
      productCode: String(row.productCode),
      versionCode: String(row.versionCode),
      audience: row.audience as BillingPlanForLifecycle["audience"],
      billingCycle: row.billingCycle as BillingPlanForLifecycle["billingCycle"],
      currency: String(row.currency),
      unitAmount: numberValue(row.unitAmount),
      capacityLimit:
        row.capacityLimit === null || row.capacityLimit === undefined
          ? null
          : numberValue(row.capacityLimit),
      entitlements: stringArray(row.entitlementsJson),
      commercialPaymentMethods: normalizeCommercialPaymentMethods(
        stringArray(row.commercialPaymentMethodsJson)
      ),
    };
  }

  async function loadEarlyConversionConfirmation(subscriptionId: string) {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT metadataJson, occurredAt
        FROM billingSubscriptionLifecycleAuditEvents
        WHERE subscriptionId = ${subscriptionId}
          AND action = 'early_conversion_confirmed'
        ORDER BY occurredAt DESC, createdAt DESC
        LIMIT 1
      `)
    );
    if (!row) return null;
    const metadata = parseObject(row.metadataJson);
    if (!metadata) return null;
    const confirmationKey = nonEmptyString(metadata.confirmationKey);
    const productCode = nonEmptyString(metadata.productCode);
    const versionCode = nonEmptyString(metadata.versionCode);
    const billingCycle = nonEmptyString(metadata.billingCycle);
    const currency = nonEmptyString(metadata.currency);
    const confirmedAt = dateOrNull(metadata.confirmedAt) ?? dateOrNull(row.occurredAt);
    const firstChargeAt = dateOrNull(metadata.firstChargeAt);
    if (
      !confirmationKey ||
      !productCode ||
      !versionCode ||
      !billingCycle ||
      !currency ||
      !confirmedAt ||
      !firstChargeAt
    ) {
      return null;
    }
    if (!['monthly', 'yearly', 'custom'].includes(billingCycle)) return null;
    return {
      confirmationKey,
      confirmedAt,
      productCode,
      versionCode,
      billingCycle: billingCycle as BillingEarlyConversionConfirmation["billingCycle"],
      currency,
      unitAmount: numberValue(metadata.unitAmount),
      capacityLimit:
        metadata.capacityLimit === null || metadata.capacityLimit === undefined
          ? null
          : numberValue(metadata.capacityLimit),
      firstChargeAt,
    };
  }

  return {
    loadContractIntent,
    hasHistoricalTransitionAccess,
    loadDelinquency,
    loadEarlyConversionConfirmation,
    loadContractPlan,
  };
}
