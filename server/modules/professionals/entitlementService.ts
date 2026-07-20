import { sql } from "drizzle-orm";
import { getDb, logPersistenceWarning } from "../../db";

export const PROFESSIONAL_ENTITLEMENT_RESOURCES = [
  "professional_dashboard",
  "professional_portfolio",
  "professional_record",
  "professional_goals",
  "professional_operational_alerts",
  "professional_messages",
  "professional_reports",
  "professional_ai_assistance",
  "professional_settings",
] as const;

export type ProfessionalEntitlementResource =
  (typeof PROFESSIONAL_ENTITLEMENT_RESOURCES)[number];

export type ProfessionalEntitlementReason =
  | "active_subscription"
  | "active_trial"
  | "admin_override"
  | "free_access"
  | "no_access";

export type ProfessionalEntitlementProviderResult = {
  allowed: boolean;
  reason: ProfessionalEntitlementReason;
  validUntil?: Date | null;
  planCode?: string | null;
  planName?: string | null;
  entitlements: string[];
  capacity?: {
    limit: number | null;
    used?: number | null;
  } | null;
};

export type ProfessionalEntitlementSnapshot = {
  allowed: boolean;
  reason: ProfessionalEntitlementReason;
  mode: "open_access" | "enforced";
  commercialState:
    | "open_access"
    | "active"
    | "trial"
    | "override"
    | "unavailable"
    | "no_access";
  planCode: string | null;
  planName: string;
  validUntil: number | null;
  enabledResources: ProfessionalEntitlementResource[];
  capacity: {
    limit: number | null;
    used: number | null;
    available: number | null;
    usageAvailable: boolean;
  };
  providerAvailable: boolean;
  fallbackUsed: boolean;
  evaluatedAt: number;
};

type EntitlementProvider = (
  professionalUserId: number
) => Promise<ProfessionalEntitlementProviderResult>;

let entitlementProvider: EntitlementProvider | null = null;

function accessMode(): "open_access" | "enforced" {
  return process.env.BILLING_ACCESS_MODE?.trim().toLowerCase() === "enforced"
    ? "enforced"
    : "open_access";
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Array<
    Record<string, unknown>
  >;
}

async function countActivePatients(professionalUserId: number) {
  try {
    const db = await getDb();
    if (!db) return null;
    const result = await db.execute(sql`
      SELECT COUNT(DISTINCT t.patientUserId) AS used
      FROM professionalPatientTrackings t
      INNER JOIN professionalPatientAuthorizations a
        ON a.id = t.authorizationId
      WHERE t.professionalUserId = ${professionalUserId}
        AND t.status = 'active'
        AND a.status = 'approved'
    `);
    const value = Number(rows(result)[0]?.used);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    logPersistenceWarning("professional_entitlement_capacity_usage", error);
    return null;
  }
}

function normalizeResources(values: string[]) {
  const allowed = new Set<string>(PROFESSIONAL_ENTITLEMENT_RESOURCES);
  return Array.from(new Set(values)).filter(
    (value): value is ProfessionalEntitlementResource => allowed.has(value)
  );
}

function stateForReason(reason: ProfessionalEntitlementReason) {
  if (reason === "active_subscription") return "active" as const;
  if (reason === "active_trial") return "trial" as const;
  if (reason === "admin_override") return "override" as const;
  if (reason === "free_access") return "open_access" as const;
  return "no_access" as const;
}

async function openAccessSnapshot(input: {
  providerAvailable: boolean;
  fallbackUsed: boolean;
}): Promise<ProfessionalEntitlementSnapshot> {
  return {
    allowed: true,
    reason: "free_access",
    mode: "open_access",
    commercialState: "open_access",
    planCode: null,
    planName: "Acesso aberto",
    validUntil: null,
    enabledResources: [...PROFESSIONAL_ENTITLEMENT_RESOURCES],
    capacity: {
      limit: null,
      used: null,
      available: null,
      usageAvailable: false,
    },
    providerAvailable: input.providerAvailable,
    fallbackUsed: input.fallbackUsed,
    evaluatedAt: Date.now(),
  };
}

export async function getProfessionalEntitlements(
  professionalUserId: number
): Promise<ProfessionalEntitlementSnapshot> {
  const mode = accessMode();
  const localUsage = await countActivePatients(professionalUserId);

  if (!entitlementProvider) {
    if (mode === "open_access") {
      const snapshot = await openAccessSnapshot({
        providerAvailable: false,
        fallbackUsed: false,
      });
      snapshot.capacity.used = localUsage;
      snapshot.capacity.usageAvailable = localUsage !== null;
      return snapshot;
    }
    return {
      allowed: false,
      reason: "no_access",
      mode,
      commercialState: "unavailable",
      planCode: null,
      planName: "Elegibilidade indisponível",
      validUntil: null,
      enabledResources: [],
      capacity: {
        limit: null,
        used: localUsage,
        available: null,
        usageAvailable: localUsage !== null,
      },
      providerAvailable: false,
      fallbackUsed: false,
      evaluatedAt: Date.now(),
    };
  }

  try {
    const result = await entitlementProvider(professionalUserId);
    const used = result.capacity?.used ?? localUsage;
    const limit = result.capacity?.limit ?? null;
    const available =
      limit !== null && used !== null ? Math.max(0, limit - used) : null;
    const validUntil = result.validUntil?.getTime() ?? null;
    const expired = validUntil !== null && validUntil <= Date.now();
    const effectiveAllowed = result.allowed && !expired;
    const effectiveReason: ProfessionalEntitlementReason = effectiveAllowed
      ? result.reason
      : "no_access";

    return {
      allowed: effectiveAllowed,
      reason: effectiveReason,
      mode,
      commercialState: stateForReason(effectiveReason),
      planCode: result.planCode?.trim() || null,
      planName: result.planName?.trim() || "Plano profissional",
      validUntil,
      enabledResources: effectiveAllowed
        ? normalizeResources(result.entitlements)
        : [],
      capacity: {
        limit,
        used,
        available,
        usageAvailable: used !== null,
      },
      providerAvailable: true,
      fallbackUsed: false,
      evaluatedAt: Date.now(),
    };
  } catch (error) {
    logPersistenceWarning("professional_entitlement_provider", error);
    if (mode === "open_access") {
      const snapshot = await openAccessSnapshot({
        providerAvailable: false,
        fallbackUsed: true,
      });
      snapshot.capacity.used = localUsage;
      snapshot.capacity.usageAvailable = localUsage !== null;
      return snapshot;
    }
    return {
      allowed: false,
      reason: "no_access",
      mode,
      commercialState: "unavailable",
      planCode: null,
      planName: "Elegibilidade indisponível",
      validUntil: null,
      enabledResources: [],
      capacity: {
        limit: null,
        used: localUsage,
        available: null,
        usageAvailable: localUsage !== null,
      },
      providerAvailable: false,
      fallbackUsed: true,
      evaluatedAt: Date.now(),
    };
  }
}

export class ProfessionalEntitlementDeniedError extends Error {}
export class ProfessionalCapacityExceededError extends Error {}

export async function assertProfessionalEntitlement(
  professionalUserId: number,
  resource: ProfessionalEntitlementResource
) {
  const snapshot = await getProfessionalEntitlements(professionalUserId);
  if (!snapshot.allowed || !snapshot.enabledResources.includes(resource)) {
    throw new ProfessionalEntitlementDeniedError(
      "Este recurso não está disponível para o acesso profissional atual."
    );
  }
  return snapshot;
}

export async function assertProfessionalCapacityAvailable(
  professionalUserId: number
) {
  const snapshot = await assertProfessionalEntitlement(
    professionalUserId,
    "professional_portfolio"
  );
  if (
    snapshot.capacity.limit !== null &&
    snapshot.capacity.used !== null &&
    snapshot.capacity.used >= snapshot.capacity.limit
  ) {
    throw new ProfessionalCapacityExceededError(
      "O limite de pacientes cobertos pelo acesso profissional foi atingido."
    );
  }
  return snapshot;
}

export function _forTestOnly_setProfessionalEntitlementProvider(
  provider: EntitlementProvider | null
) {
  entitlementProvider = provider;
}
