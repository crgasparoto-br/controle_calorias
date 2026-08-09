import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import {
  INITIAL_BILLING_CATALOG,
  assertCatalogVersionCanActivate,
  evaluateCouponEligibility,
  isCatalogVersionEffective,
  normalizeCatalogEntitlements,
  normalizeCatalogMutationProvenance,
  normalizeCommercialPaymentMethods,
  validateCouponPolicy,
  type BillingCatalogVersionDefinition,
  type BillingCouponPolicy,
} from "../modules/billing/catalogPolicy";
import type {
  BillingCatalogProductRecord,
  BillingCatalogRepository,
  BillingCatalogVersionRecord,
  BillingCouponRecord,
  BillingCouponUsageStats,
  CreateBillingCatalogProductInput,
  CreateBillingCatalogVersionInput,
  CreateBillingCouponRevisionInput,
  DeactivateBillingCatalogVersionInput,
  DeactivateBillingCouponInput,
  PublishBillingCatalogVersionInput,
  ReserveBillingCouponInput,
  ReserveBillingCouponResult,
} from "../modules/billing/catalogTypes";
import {
  dateOrNull,
  numberValue,
  requireDb,
  resultRows,
  stringArray,
  type BillingRepositoryDeps,
  type SqlExecutor,
  type TransactionalSqlExecutor,
} from "./billingRepositorySupport";

function normalizedCode(value: string) {
  return value.trim().toLowerCase();
}

function normalizedCouponCode(value: string) {
  return value.trim().toUpperCase();
}

export function buildBillingCatalogSeedId(
  kind: "product" | "version",
  code: string
) {
  return crypto
    .createHash("sha256")
    .update(`billing-catalog-${kind}:${code}`)
    .digest("hex");
}

function mapProduct(row: Record<string, unknown>): BillingCatalogProductRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    audience: row.audience as BillingCatalogProductRecord["audience"],
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    state: row.state as BillingCatalogProductRecord["state"],
    createdAt: dateOrNull(row.createdAt) ?? new Date(0),
    updatedAt: dateOrNull(row.updatedAt) ?? new Date(0),
  };
}

function mapVersion(row: Record<string, unknown>): BillingCatalogVersionRecord {
  return {
    id: String(row.id),
    productId: String(row.productId),
    productState: (row.productState ?? "active") as "active" | "inactive",
    productCode: String(row.productCode ?? row.code),
    versionCode: String(row.versionCode),
    version: numberValue(row.version),
    audience: row.audience as BillingCatalogVersionRecord["audience"],
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    billingCycle: row.billingCycle as BillingCatalogVersionRecord["billingCycle"],
    currency: String(row.currency) as "BRL",
    unitAmount: numberValue(row.unitAmount),
    capacityLimit:
      row.capacityLimit == null ? null : numberValue(row.capacityLimit),
    entitlements: stringArray(row.entitlementsJson),
    coveredBeneficiaryEntitlements: stringArray(
      row.coveredBeneficiaryEntitlementsJson
    ),
    commercialPaymentMethods: normalizeCommercialPaymentMethods(
      stringArray(row.commercialPaymentMethodsJson)
    ),
    effectiveFrom: dateOrNull(row.effectiveFrom) ?? new Date(0),
    effectiveUntil: dateOrNull(row.effectiveUntil),
    status: row.status as BillingCatalogVersionRecord["status"],
    sortOrder: numberValue(row.sortOrder),
    createdByUserId:
      row.createdByUserId == null ? null : numberValue(row.createdByUserId),
    createdAt: dateOrNull(row.createdAt) ?? new Date(0),
    updatedAt: dateOrNull(row.updatedAt) ?? new Date(0),
  };
}

function mapCoupon(row: Record<string, unknown>): BillingCouponRecord {
  const state = row.state as BillingCouponRecord["state"];
  return {
    id: String(row.id),
    code: String(row.code),
    revision: numberValue(row.revision),
    discountType: row.discountType as BillingCouponRecord["discountType"],
    discountValue: numberValue(row.discountValue),
    currency: row.currency == null ? null : String(row.currency),
    eligibleProductCodes: stringArray(row.eligibleProductCodesJson),
    eligibleVersionCodes: stringArray(row.eligibleVersionCodesJson),
    eligibleCycles: stringArray(row.eligibleCyclesJson) as BillingCouponRecord["eligibleCycles"],
    validFrom: dateOrNull(row.validFrom) ?? new Date(0),
    validUntil: dateOrNull(row.validUntil),
    maxTotalUses: row.maxTotalUses == null ? null : numberValue(row.maxTotalUses),
    maxUsesPerUser:
      row.maxUsesPerUser == null ? null : numberValue(row.maxUsesPerUser),
    firstContractOnly: Boolean(row.firstContractOnly),
    durationCharges: numberValue(row.durationCharges),
    active: state === "active",
    state,
    supersedesCouponId:
      row.supersedesCouponId == null ? null : String(row.supersedesCouponId),
    createdByUserId:
      row.createdByUserId == null ? null : numberValue(row.createdByUserId),
    deactivatedByUserId:
      row.deactivatedByUserId == null
        ? null
        : numberValue(row.deactivatedByUserId),
    deactivatedAt: dateOrNull(row.deactivatedAt),
    createdAt: dateOrNull(row.createdAt) ?? new Date(0),
    updatedAt: dateOrNull(row.updatedAt) ?? new Date(0),
  };
}

async function insertCommercialAuditEvent(
  executor: SqlExecutor,
  input: {
    actorUserId: number;
    entityType: "product" | "version" | "coupon";
    entityId: string;
    action: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }
) {
  await executor.execute(sql`
    INSERT INTO billingCommercialAuditEvents (
      id, actorUserId, entityType, entityId, action, reason, metadataJson, createdAt
    ) VALUES (
      ${crypto.randomUUID()}, ${input.actorUserId}, ${input.entityType},
      ${input.entityId}, ${input.action}, ${input.reason},
      ${input.metadata ? JSON.stringify(input.metadata) : null}, NOW()
    )
  `);
}

function catalogMutationAuditMetadata(
  provenance: CreateBillingCatalogProductInput["provenance"],
  metadata: Record<string, unknown>
) {
  const normalized = normalizeCatalogMutationProvenance(provenance);
  return normalized.origin === "catalog_range_review"
    ? {
        ...metadata,
        provenance: {
          origin: normalized.origin,
          alertIds: normalized.alertIds,
          analysisRef: normalized.analysisRef,
        },
      }
    : {
        ...metadata,
        provenance: { origin: normalized.origin },
      };
}

async function loadCouponUsageStats(
  executor: SqlExecutor,
  couponId: string,
  userId: number,
  lock = false
): Promise<BillingCouponUsageStats> {
  // A locking read is required here: this runs after the caller waits on the
  // billingCoupons row lock, and under REPEATABLE READ a plain SELECT still
  // sees the transaction's original snapshot, not redemptions committed by
  // the transaction we just waited on. FOR UPDATE forces a fresh read.
  const lockClause = lock ? sql` FOR UPDATE` : sql``;
  const [usage] = resultRows<Record<string, unknown>>(
    await executor.execute(sql`
      SELECT
        SUM(CASE WHEN redemption.state IN ('reserved', 'confirmed') THEN 1 ELSE 0 END) AS totalUses,
        SUM(CASE WHEN redemption.userId = ${userId} AND redemption.state IN ('reserved', 'confirmed') THEN 1 ELSE 0 END) AS userUses
      FROM billingCouponRedemptions redemption
      INNER JOIN billingCoupons usedCoupon ON usedCoupon.id = redemption.couponId
      INNER JOIN billingCoupons targetCoupon ON targetCoupon.id = ${couponId}
      WHERE usedCoupon.code = targetCoupon.code${lockClause}
    `)
  );
  const [contract] = resultRows<Record<string, unknown>>(
    await executor.execute(sql`
      SELECT id
      FROM billingSubscriptions
      WHERE payerUserId = ${userId}
        AND status IN ('active', 'past_due', 'canceled', 'expired')
      LIMIT 1${lockClause}
    `)
  );
  return {
    totalConfirmedOrReserved: numberValue(usage?.totalUses),
    userConfirmedOrReserved: numberValue(usage?.userUses),
    userHasPriorPaidContract: !!contract,
  };
}

async function selectVersionByCode(
  executor: SqlExecutor,
  versionCode: string,
  lock = false
) {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const [row] = resultRows<Record<string, unknown>>(
    await executor.execute(sql`
      SELECT v.*, p.code AS productCode, p.state AS productState, p.audience, p.name,
        COALESCE(v.description, p.description) AS description
      FROM billingPlans v
      INNER JOIN billingProducts p ON p.id = v.productId
      WHERE v.versionCode = ${versionCode}
      LIMIT 1${suffix}
    `)
  );
  return row ? mapVersion(row) : null;
}

function assertSeedMatches(
  existing: BillingCatalogVersionRecord,
  expected: BillingCatalogVersionDefinition
) {
  const comparable = {
    productCode: existing.productCode,
    versionCode: existing.versionCode,
    version: existing.version,
    audience: existing.audience,
    name: existing.name,
    billingCycle: existing.billingCycle,
    currency: existing.currency,
    unitAmount: existing.unitAmount,
    capacityLimit: existing.capacityLimit,
    entitlements: [...existing.entitlements].sort(),
    coveredBeneficiaryEntitlements: [
      ...existing.coveredBeneficiaryEntitlements,
    ].sort(),
    paymentMethods: [...existing.commercialPaymentMethods].sort(),
    sortOrder: existing.sortOrder,
  };
  const target = {
    productCode: expected.productCode,
    versionCode: expected.versionCode,
    version: expected.version,
    audience: expected.audience,
    name: expected.name,
    billingCycle: expected.billingCycle,
    currency: expected.currency,
    unitAmount: expected.unitAmount,
    capacityLimit: expected.capacityLimit,
    entitlements: normalizeCatalogEntitlements(expected.entitlements),
    coveredBeneficiaryEntitlements: normalizeCatalogEntitlements(
      expected.coveredBeneficiaryEntitlements
    ),
    paymentMethods: normalizeCommercialPaymentMethods(
      expected.commercialPaymentMethods
    ),
    sortOrder: expected.sortOrder,
  };
  if (JSON.stringify(comparable) !== JSON.stringify(target)) {
    throw new Error(
      `Billing catalog seed drift detected for ${expected.versionCode}.`
    );
  }
}

type BillingCatalogRepositoryDeps = BillingRepositoryDeps & {
  onAdminAuthorizationLocked?: (actorUserId: number) => Promise<void>;
};

async function assertAdminActor(
  executor: SqlExecutor,
  actorUserId: number,
  onLocked?: (actorUserId: number) => Promise<void>
) {
  const [admin] = resultRows<Record<string, unknown>>(
    await executor.execute(sql`
      SELECT id FROM users
      WHERE id = ${actorUserId} AND role = 'admin'
      LIMIT 1 FOR UPDATE
    `)
  );
  if (!admin) {
    throw new Error(
      "Administrator authorization changed before catalog mutation."
    );
  }
  await onLocked?.(actorUserId);
}

export function createBillingCatalogRepository(
  deps: BillingCatalogRepositoryDeps
): BillingCatalogRepository {
  async function listEffectiveVersions(now: Date) {
    const db = await requireDb(deps.getDb);
    return resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT v.*, p.code AS productCode, p.state AS productState, p.audience, p.name,
          COALESCE(v.description, p.description) AS description
        FROM billingPlans v
        INNER JOIN billingProducts p ON p.id = v.productId
        WHERE p.state = 'active'
          AND v.status = 'active'
          AND v.effectiveFrom <= ${now}
          AND (v.effectiveUntil IS NULL OR v.effectiveUntil > ${now})
        ORDER BY v.sortOrder ASC, p.code ASC, v.version DESC
      `)
    ).map(mapVersion);
  }

  async function listAllVersions(limit: number) {
    const db = await requireDb(deps.getDb);
    return resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT v.*, p.code AS productCode, p.state AS productState, p.audience, p.name,
          COALESCE(v.description, p.description) AS description
        FROM billingPlans v
        INNER JOIN billingProducts p ON p.id = v.productId
        ORDER BY v.createdAt DESC, v.id DESC
        LIMIT ${limit}
      `)
    ).map(mapVersion);
  }

  async function getVersionByCode(versionCode: string) {
    const db = await requireDb(deps.getDb);
    return selectVersionByCode(db, versionCode);
  }

  async function listCoupons(limit: number) {
    const db = await requireDb(deps.getDb);
    return resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT * FROM billingCoupons
        ORDER BY code ASC, revision DESC, id DESC
        LIMIT ${limit}
      `)
    ).map(mapCoupon);
  }

  async function getActiveCouponByCode(code: string) {
    const db = await requireDb(deps.getDb);
    const normalized = normalizedCouponCode(code);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT * FROM billingCoupons
        WHERE activeCodeKey = ${normalized} AND state = 'active'
        LIMIT 1
      `)
    );
    return row ? mapCoupon(row) : null;
  }

  async function getCouponUsageStats(couponId: string, userId: number) {
    const db = await requireDb(deps.getDb);
    return loadCouponUsageStats(db, couponId, userId);
  }

  async function createProduct(input: CreateBillingCatalogProductInput) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      const provenance = normalizeCatalogMutationProvenance(input.provenance);
      await assertAdminActor(
        tx,
        input.actorUserId,
        deps.onAdminAuthorizationLocked
      );
      const code = normalizedCode(input.code);
      const id = crypto.randomUUID();
      await tx.execute(sql`
        INSERT INTO billingProducts (
          id, code, audience, name, description, state, createdAt, updatedAt
        ) VALUES (
          ${id}, ${code}, ${input.audience}, ${input.name.trim()},
          ${input.description?.trim() || null}, 'active', NOW(), NOW()
        )
      `);
      await insertCommercialAuditEvent(tx, {
        actorUserId: input.actorUserId,
        entityType: "product",
        entityId: id,
        action: "product_created",
        reason: input.reason,
        metadata: catalogMutationAuditMetadata(provenance, {
          code,
          audience: input.audience,
        }),
      });
      const [row] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`SELECT * FROM billingProducts WHERE id = ${id} LIMIT 1`)
      );
      if (!row) throw new Error("Billing product was not persisted.");
      return mapProduct(row);
    });
  }

  async function createVersion(input: CreateBillingCatalogVersionInput) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      const provenance = normalizeCatalogMutationProvenance(input.provenance);
      await assertAdminActor(
        tx,
        input.actorUserId,
        deps.onAdminAuthorizationLocked
      );
      const productCode = normalizedCode(input.productCode);
      const [product] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingProducts
          WHERE code = ${productCode}
          LIMIT 1 FOR UPDATE
        `)
      );
      if (!product) throw new Error("Billing product not found.");
      const [sequence] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion
          FROM billingPlans
          WHERE productId = ${String(product.id)}
            AND billingCycle = ${input.billingCycle}
        `)
      );
      const version = Math.max(1, numberValue(sequence?.nextVersion));
      const versionCode = `${productCode}-${input.billingCycle}-v${version}`;
      const definition: BillingCatalogVersionDefinition = {
        productCode,
        versionCode,
        version,
        audience: product.audience as BillingCatalogVersionDefinition["audience"],
        name: input.name.trim(),
        billingCycle: input.billingCycle,
        currency: input.currency,
        unitAmount: input.unitAmount,
        capacityLimit: input.capacityLimit,
        entitlements: normalizeCatalogEntitlements(input.entitlements),
        coveredBeneficiaryEntitlements: normalizeCatalogEntitlements(
          input.coveredBeneficiaryEntitlements
        ),
        commercialPaymentMethods: normalizeCommercialPaymentMethods(
          input.commercialPaymentMethods
        ),
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil ?? null,
        status: "draft",
        sortOrder: input.sortOrder,
      };
      assertCatalogVersionCanActivate(definition);
      const id = crypto.randomUUID();
      await tx.execute(sql`
        INSERT INTO billingPlans (
          id, productId, code, versionCode, version, audience, name, description,
          currency, unitAmount, billingCycle, capacityLimit, entitlementsJson,
          coveredBeneficiaryEntitlementsJson, commercialPaymentMethodsJson,
          status, active, effectiveFrom,
          effectiveUntil, sortOrder, createdByUserId, createdAt, updatedAt
        ) VALUES (
          ${id}, ${String(product.id)}, ${productCode}, ${versionCode}, ${version},
          ${definition.audience}, ${definition.name},
          ${input.description?.trim() || null}, ${definition.currency},
          ${definition.unitAmount}, ${definition.billingCycle},
          ${definition.capacityLimit}, ${JSON.stringify(definition.entitlements)},
          ${JSON.stringify(definition.coveredBeneficiaryEntitlements)},
          ${JSON.stringify(definition.commercialPaymentMethods)}, 'draft', false,
          ${definition.effectiveFrom}, ${definition.effectiveUntil},
          ${definition.sortOrder}, ${input.actorUserId}, NOW(), NOW()
        )
      `);
      await insertCommercialAuditEvent(tx, {
        actorUserId: input.actorUserId,
        entityType: "version",
        entityId: id,
        action: "version_created",
        reason: input.reason,
        metadata: catalogMutationAuditMetadata(provenance, {
          productCode,
          versionCode,
          billingCycle: input.billingCycle,
        }),
      });
      const created = await selectVersionByCode(tx, versionCode);
      if (!created) throw new Error("Billing catalog version was not persisted.");
      return created;
    });
  }

  async function publishVersion(input: PublishBillingCatalogVersionInput) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      const provenance = normalizeCatalogMutationProvenance(input.provenance);
      await assertAdminActor(
        tx,
        input.actorUserId,
        deps.onAdminAuthorizationLocked
      );
      const target = await selectVersionByCode(tx, input.versionCode, true);
      if (!target) throw new Error("Billing catalog version not found.");
      const effectiveFrom = input.effectiveFrom;
      assertCatalogVersionCanActivate({
        ...target,
        status: "active",
        effectiveFrom,
      });
      const [latestPublished] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id, effectiveFrom
          FROM billingPlans
          WHERE productId = ${target.productId}
            AND billingCycle = ${target.billingCycle}
            AND status = 'active'
            AND id <> ${target.id}
          ORDER BY effectiveFrom DESC, version DESC
          LIMIT 1 FOR UPDATE
        `)
      );
      const latestEffectiveFrom = dateOrNull(latestPublished?.effectiveFrom);
      if (
        latestEffectiveFrom &&
        effectiveFrom.getTime() <= latestEffectiveFrom.getTime()
      ) {
        throw new Error(
          "Catalog publication must advance the commercial effective date."
        );
      }
      await tx.execute(sql`
        UPDATE billingPlans
        SET effectiveUntil = CASE
            WHEN effectiveUntil IS NULL OR effectiveUntil > ${effectiveFrom}
              THEN ${effectiveFrom}
            ELSE effectiveUntil
          END,
          updatedAt = NOW()
        WHERE productId = ${target.productId}
          AND billingCycle = ${target.billingCycle}
          AND status = 'active'
          AND id <> ${target.id}
      `);
      await tx.execute(sql`
        UPDATE billingPlans
        SET status = 'active', active = true, effectiveFrom = ${effectiveFrom},
          effectiveUntil = ${target.effectiveUntil}, updatedAt = NOW()
        WHERE id = ${target.id}
      `);
      await insertCommercialAuditEvent(tx, {
        actorUserId: input.actorUserId,
        entityType: "version",
        entityId: target.id,
        action: "version_published",
        reason: input.reason,
        metadata: catalogMutationAuditMetadata(provenance, {
          versionCode: target.versionCode,
        }),
      });
      const published = await selectVersionByCode(tx, target.versionCode);
      if (!published) throw new Error("Billing catalog version not found after publication.");
      return published;
    });
  }

  async function deactivateVersion(input: DeactivateBillingCatalogVersionInput) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      await assertAdminActor(
        tx,
        input.actorUserId,
        deps.onAdminAuthorizationLocked
      );
      const target = await selectVersionByCode(tx, input.versionCode, true);
      if (!target) throw new Error("Billing catalog version not found.");
      if (input.effectiveUntil.getTime() <= target.effectiveFrom.getTime()) {
        throw new Error("Catalog version end must be after its effective start.");
      }
      await tx.execute(sql`
        UPDATE billingPlans
        SET status = 'inactive', active = false,
          effectiveUntil = ${input.effectiveUntil}, updatedAt = NOW()
        WHERE id = ${target.id}
      `);
      await insertCommercialAuditEvent(tx, {
        actorUserId: input.actorUserId,
        entityType: "version",
        entityId: target.id,
        action: "version_deactivated",
        reason: input.reason,
        metadata: { versionCode: target.versionCode },
      });
      const deactivated = await selectVersionByCode(tx, target.versionCode);
      if (!deactivated) throw new Error("Billing catalog version not found after deactivation.");
      return deactivated;
    });
  }

  async function createCouponRevision(input: CreateBillingCouponRevisionInput) {
    const db = await requireDb(deps.getDb);
    const policy = validateCouponPolicy(input.policy);
    return db.transaction(async tx => {
      await assertAdminActor(
        tx,
        input.actorUserId,
        deps.onAdminAuthorizationLocked
      );
      for (const productCode of policy.eligibleProductCodes) {
        const [product] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT id FROM billingProducts WHERE code = ${productCode} LIMIT 1
          `)
        );
        if (!product) {
          throw new Error(
            `Billing coupon references unknown product: ${productCode}.`
          );
        }
      }
      for (const versionCode of policy.eligibleVersionCodes) {
        const version = await selectVersionByCode(tx, versionCode);
        if (!version) {
          throw new Error(
            `Billing coupon references unknown version: ${versionCode}.`
          );
        }
      }
      const code = normalizedCouponCode(policy.code);
      const [current] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingCoupons
          WHERE activeCodeKey = ${code} AND state = 'active'
          LIMIT 1 FOR UPDATE
        `)
      );
      const [sequence] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT COALESCE(MAX(revision), 0) + 1 AS nextRevision
          FROM billingCoupons WHERE code = ${code}
        `)
      );
      const revision = Math.max(1, numberValue(sequence?.nextRevision));
      const id = crypto.randomUUID();
      if (current) {
        await tx.execute(sql`
          UPDATE billingCoupons
          SET state = 'inactive', activeCodeKey = NULL,
            deactivatedByUserId = ${input.actorUserId}, deactivatedAt = NOW(),
            updatedAt = NOW()
          WHERE id = ${String(current.id)}
        `);
      }
      await tx.execute(sql`
        INSERT INTO billingCoupons (
          id, code, revision, activeCodeKey, discountType, discountValue,
          currency, eligibleProductCodesJson, eligibleVersionCodesJson,
          eligibleCyclesJson, validFrom, validUntil, maxTotalUses,
          maxUsesPerUser, firstContractOnly, durationCharges, state,
          supersedesCouponId, createdByUserId, createdAt, updatedAt
        ) VALUES (
          ${id}, ${code}, ${revision}, ${policy.active ? code : null},
          ${policy.discountType}, ${policy.discountValue}, ${policy.currency},
          ${JSON.stringify(policy.eligibleProductCodes)},
          ${JSON.stringify(policy.eligibleVersionCodes)},
          ${JSON.stringify(policy.eligibleCycles)}, ${policy.validFrom},
          ${policy.validUntil}, ${policy.maxTotalUses}, ${policy.maxUsesPerUser},
          ${policy.firstContractOnly}, ${policy.durationCharges},
          ${policy.active ? "active" : "inactive"},
          ${current ? String(current.id) : null}, ${input.actorUserId}, NOW(), NOW()
        )
      `);
      await insertCommercialAuditEvent(tx, {
        actorUserId: input.actorUserId,
        entityType: "coupon",
        entityId: id,
        action: current ? "coupon_revised" : "coupon_created",
        reason: input.reason,
        metadata: { code, revision },
      });
      const [row] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`SELECT * FROM billingCoupons WHERE id = ${id} LIMIT 1`)
      );
      if (!row) throw new Error("Billing coupon was not persisted.");
      return mapCoupon(row);
    });
  }

  async function deactivateCoupon(input: DeactivateBillingCouponInput) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      await assertAdminActor(
        tx,
        input.actorUserId,
        deps.onAdminAuthorizationLocked
      );
      const code = normalizedCouponCode(input.code);
      const [row] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingCoupons
          WHERE activeCodeKey = ${code} AND state = 'active'
          LIMIT 1 FOR UPDATE
        `)
      );
      if (!row) throw new Error("Billing coupon not found.");
      await tx.execute(sql`
        UPDATE billingCoupons
        SET state = 'inactive', activeCodeKey = NULL,
          deactivatedByUserId = ${input.actorUserId}, deactivatedAt = NOW(),
          updatedAt = NOW()
        WHERE id = ${String(row.id)}
      `);
      await insertCommercialAuditEvent(tx, {
        actorUserId: input.actorUserId,
        entityType: "coupon",
        entityId: String(row.id),
        action: "coupon_deactivated",
        reason: input.reason,
        metadata: { code },
      });
      const [updated] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`SELECT * FROM billingCoupons WHERE id = ${String(row.id)} LIMIT 1`)
      );
      if (!updated) throw new Error("Billing coupon not found after deactivation.");
      return mapCoupon(updated);
    });
  }

  async function reserveCoupon(
    input: ReserveBillingCouponInput
  ): Promise<ReserveBillingCouponResult> {
    const db = await requireDb(deps.getDb);
    return db.transaction<ReserveBillingCouponResult>(async tx => {
      const [user] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id FROM users WHERE id = ${input.userId} LIMIT 1 FOR UPDATE
        `)
      );
      if (!user) throw new Error("Billing coupon user not found.");
      const code = normalizedCouponCode(input.couponCode);

      async function findExistingReservation() {
        const [existing] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT r.*, c.code AS couponCode, c.durationCharges,
              v.versionCode
            FROM billingCouponRedemptions r
            INNER JOIN billingCoupons c ON c.id = r.couponId
            INNER JOIN billingPlans v ON v.id = r.planId
            WHERE r.contractKey = ${input.contractKey}
            LIMIT 1
          `)
        );
        if (!existing) return null;
        if (
          numberValue(existing.userId) !== input.userId ||
          String(existing.couponCode) !== code ||
          String(existing.versionCode) !== input.versionCode
        ) {
          throw new Error(
            "Coupon contract key was already used by another reservation."
          );
        }
        const discountAmount = numberValue(existing.discountAmount);
        const finalAmount = numberValue(existing.finalAmount);
        return {
          reserved: true as const,
          eligibility: {
            eligible: true as const,
            discountAmount,
            finalAmount,
            durationCharges: numberValue(existing.durationCharges),
          },
          reservation: {
            id: String(existing.id),
            couponId: String(existing.couponId),
            userId: input.userId,
            contractKey: input.contractKey,
            state: existing.state as "reserved" | "confirmed" | "canceled",
            discountAmount,
            finalAmount,
            created: false,
          },
        };
      }

      const preexisting = await findExistingReservation();
      if (preexisting) return preexisting;

      const [couponRow] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingCoupons
          WHERE activeCodeKey = ${code} AND state = 'active'
          LIMIT 1 FOR UPDATE
        `)
      );
      if (!couponRow) {
        return {
          reserved: false,
          eligibility: { eligible: false, reason: "inactive" },
        };
      }

      // A competing transaction may have committed the same contract key while
      // this transaction waited on the coupon row lock. Re-read after the lock.
      const committedWhileWaiting = await findExistingReservation();
      if (committedWhileWaiting) return committedWhileWaiting;

      const coupon = mapCoupon(couponRow);
      const version = await selectVersionByCode(tx, input.versionCode, true);
      if (
        !version ||
        version.productState !== "active" ||
        !isCatalogVersionEffective(version, input.now)
      ) {
        return {
          reserved: false,
          eligibility: { eligible: false, reason: "version_not_eligible" },
        };
      }

      const stats = await loadCouponUsageStats(tx, coupon.id, input.userId, true);
      const eligibility = evaluateCouponEligibility(coupon, {
        now: input.now,
        productCode: version.productCode,
        versionCode: version.versionCode,
        billingCycle: version.billingCycle,
        unitAmount: version.unitAmount,
        currency: version.currency,
        totalConfirmedUses: stats.totalConfirmedOrReserved,
        userConfirmedUses: stats.userConfirmedOrReserved,
        userHasPriorPaidContract: stats.userHasPriorPaidContract,
      });
      if (eligibility.eligible === false) {
        return { reserved: false, eligibility };
      }

      const id = crypto.randomUUID();
      await tx.execute(sql`
        INSERT INTO billingCouponRedemptions (
          id, couponId, planId, userId, contractKey, state,
          discountAmount, finalAmount, reservedAt, createdAt, updatedAt
        ) VALUES (
          ${id}, ${coupon.id}, ${version.id}, ${input.userId},
          ${input.contractKey}, 'reserved', ${eligibility.discountAmount},
          ${eligibility.finalAmount}, NOW(), NOW(), NOW()
        )
      `);
      return {
        reserved: true,
        eligibility,
        reservation: {
          id,
          couponId: coupon.id,
          userId: input.userId,
          contractKey: input.contractKey,
          state: "reserved",
          discountAmount: eligibility.discountAmount,
          finalAmount: eligibility.finalAmount,
          created: true,
        },
      };
    });
  }

  async function seedInitialCatalog(
    definitions: readonly BillingCatalogVersionDefinition[] = INITIAL_BILLING_CATALOG
  ) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      let products = 0;
      let versions = 0;
      const grouped = new Map<
        string,
        Pick<BillingCatalogVersionDefinition, "productCode" | "audience" | "name">
      >();
      for (const definition of definitions) {
        assertCatalogVersionCanActivate(definition);
        grouped.set(definition.productCode, definition);
      }

      for (const product of grouped.values()) {
        const id = buildBillingCatalogSeedId("product", product.productCode);
        const [existing] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT * FROM billingProducts WHERE code = ${product.productCode} LIMIT 1
          `)
        );
        if (!existing) {
          await tx.execute(sql`
            INSERT INTO billingProducts (
              id, code, audience, name, state, createdAt, updatedAt
            ) VALUES (
              ${id}, ${product.productCode}, ${product.audience}, ${product.name},
              'active', NOW(), NOW()
            )
          `);
          products += 1;
        } else if (
          String(existing.audience) !== product.audience ||
          String(existing.name) !== product.name
        ) {
          throw new Error(`Billing catalog seed drift detected for product ${product.productCode}.`);
        }
      }

      for (const definition of definitions) {
        const existing = await selectVersionByCode(tx, definition.versionCode);
        if (existing) {
          assertSeedMatches(existing, definition);
          continue;
        }
        const [product] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT id FROM billingProducts WHERE code = ${definition.productCode} LIMIT 1
          `)
        );
        if (!product) throw new Error("Billing product seed was not persisted.");
        const id = buildBillingCatalogSeedId("version", definition.versionCode);
        await tx.execute(sql`
          INSERT INTO billingPlans (
            id, productId, code, versionCode, version, audience, name,
            currency, unitAmount, billingCycle, capacityLimit, entitlementsJson,
            coveredBeneficiaryEntitlementsJson, commercialPaymentMethodsJson,
            status, active, effectiveFrom,
            effectiveUntil, sortOrder, createdAt, updatedAt
          ) VALUES (
            ${id}, ${String(product.id)}, ${definition.productCode},
            ${definition.versionCode}, ${definition.version}, ${definition.audience},
            ${definition.name}, ${definition.currency}, ${definition.unitAmount},
            ${definition.billingCycle}, ${definition.capacityLimit},
            ${JSON.stringify(normalizeCatalogEntitlements(definition.entitlements))},
            ${JSON.stringify(
              normalizeCatalogEntitlements(
                definition.coveredBeneficiaryEntitlements
              )
            )},
            ${JSON.stringify(normalizeCommercialPaymentMethods(definition.commercialPaymentMethods))},
            ${definition.status}, ${definition.status === "active"},
            ${definition.effectiveFrom}, ${definition.effectiveUntil},
            ${definition.sortOrder}, NOW(), NOW()
          )
        `);
        versions += 1;
      }
      return { products, versions };
    });
  }

  return {
    listEffectiveVersions,
    listAllVersions,
    getVersionByCode,
    listCoupons,
    getActiveCouponByCode,
    getCouponUsageStats,
    createProduct,
    createVersion,
    publishVersion,
    deactivateVersion,
    createCouponRevision,
    deactivateCoupon,
    reserveCoupon,
    seedInitialCatalog,
  };
}
