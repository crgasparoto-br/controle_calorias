import { logPersistenceWarning } from "../../db";

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

export type ProfessionalCapacityReservationInput = {
  professionalUserId: number;
  coverageKey: string;
  patientUserId: number;
};

export type ProfessionalCapacityReservationResult =
  | {
      reserved: true;
      reservationId: string;
    }
  | {
      reserved: false;
      reason: "capacity_exceeded" | "unavailable";
    };

export type ProfessionalEntitlementProvider = {
  getEntitlements: (
    professionalUserId: number
  ) => Promise<ProfessionalEntitlementProviderResult>;
  reserveCapacity?: (
    input: ProfessionalCapacityReservationInput
  ) => Promise<ProfessionalCapacityReservationResult>;
  releaseCapacity?: (input: {
    professionalUserId: number;
    reservationId: string;
    coverageKey: string;
  }) => Promise<void>;
};

type LegacyProfessionalEntitlementProvider = (
  professionalUserId: number
) => Promise<ProfessionalEntitlementProviderResult>;

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

let entitlementProvider: ProfessionalEntitlementProvider | null = null;

export function configureProfessionalEntitlementProvider(
  provider:
    | ProfessionalEntitlementProvider
    | LegacyProfessionalEntitlementProvider
    | null
) {
  entitlementProvider =
    typeof provider === "function"
      ? { getEntitlements: provider }
      : provider;
}

function accessMode(): "open_access" | "enforced" {
  return process.env.BILLING_ACCESS_MODE?.trim().toLowerCase() === "enforced"
    ? "enforced"
    : "open_access";
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

function openAccessSnapshot(input: {
  providerAvailable: boolean;
  fallbackUsed: boolean;
}): ProfessionalEntitlementSnapshot {
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

function unavailableSnapshot(
  mode: "open_access" | "enforced",
  fallbackUsed: boolean
): ProfessionalEntitlementSnapshot {
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
      used: null,
      available: null,
      usageAvailable: false,
    },
    providerAvailable: false,
    fallbackUsed,
    evaluatedAt: Date.now(),
  };
}

export async function getProfessionalEntitlements(
  professionalUserId: number
): Promise<ProfessionalEntitlementSnapshot> {
  const mode = accessMode();

  if (!entitlementProvider) {
    return mode === "open_access"
      ? openAccessSnapshot({ providerAvailable: false, fallbackUsed: false })
      : unavailableSnapshot(mode, false);
  }

  try {
    const result = await entitlementProvider.getEntitlements(
      professionalUserId
    );
    const used = result.capacity?.used ?? null;
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
    return mode === "open_access"
      ? openAccessSnapshot({ providerAvailable: false, fallbackUsed: true })
      : unavailableSnapshot(mode, true);
  }
}

export class ProfessionalEntitlementDeniedError extends Error {}
export class ProfessionalCapacityExceededError extends Error {}
export class ProfessionalCapacityUnavailableError extends Error {}

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

export async function withProfessionalCapacityReservation<T>(
  input: ProfessionalCapacityReservationInput,
  operation: () => Promise<T>
): Promise<T> {
  const snapshot = await assertProfessionalCapacityAvailable(
    input.professionalUserId
  );
  if (snapshot.capacity.limit === null) return operation();

  if (snapshot.capacity.used === null) {
    throw new ProfessionalCapacityUnavailableError(
      "Não foi possível confirmar o uso da capacidade contratada. Tente novamente."
    );
  }

  if (!entitlementProvider?.reserveCapacity) {
    throw new ProfessionalCapacityUnavailableError(
      "O serviço central de capacidade ainda não está disponível para aprovar este acompanhamento."
    );
  }

  let reservation: ProfessionalCapacityReservationResult;
  try {
    reservation = await entitlementProvider.reserveCapacity(input);
  } catch (error) {
    logPersistenceWarning("professional_capacity_reservation", error);
    throw new ProfessionalCapacityUnavailableError(
      "Não foi possível reservar a capacidade contratada. Tente novamente."
    );
  }

  if (!reservation.reserved) {
    if (reservation.reason === "capacity_exceeded") {
      throw new ProfessionalCapacityExceededError(
        "O limite de pacientes cobertos pelo acesso profissional foi atingido."
      );
    }
    throw new ProfessionalCapacityUnavailableError(
      "Não foi possível reservar a capacidade contratada. Tente novamente."
    );
  }

  try {
    return await operation();
  } catch (error) {
    if (entitlementProvider.releaseCapacity) {
      try {
        await entitlementProvider.releaseCapacity({
          professionalUserId: input.professionalUserId,
          reservationId: reservation.reservationId,
          coverageKey: input.coverageKey,
        });
      } catch (releaseError) {
        logPersistenceWarning(
          "professional_capacity_reservation_release",
          releaseError
        );
      }
    }
    throw error;
  }
}

export function _forTestOnly_setProfessionalEntitlementProvider(
  provider:
    | ProfessionalEntitlementProvider
    | LegacyProfessionalEntitlementProvider
    | null
) {
  configureProfessionalEntitlementProvider(provider);
}
