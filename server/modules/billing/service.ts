import { getDb, logPersistenceWarning } from "../../db";
import {
  BillingPersistenceUnavailableError,
  createDrizzleBillingRepository,
} from "../../repositories/billingRepository";
import type {
  BillingAccessMode,
  BillingAccessReason,
  BillingAdminUserAccess,
  BillingEntitlementCandidate,
  BillingRepository,
  GrantBillingOverrideInput,
  RevokeBillingOverrideInput,
  UserEntitlementsResult,
} from "./types";

const ACCESS_PRIORITY: Record<Exclude<BillingAccessReason, "no_access">, number> = {
  active_subscription: 0,
  sponsored_by_professional: 1,
  active_trial: 2,
  admin_override: 3,
  free_access: 4,
};

export function getBillingAccessMode(): BillingAccessMode {
  return process.env.BILLING_ACCESS_MODE?.trim().toLowerCase() === "enforced"
    ? "enforced"
    : "open_access";
}

function uniqueEntitlements(values: string[]) {
  return Array.from(
    new Set(values.map(value => value.trim()).filter(Boolean))
  ).sort();
}

function isCandidateActive(candidate: BillingEntitlementCandidate, now: Date) {
  if (candidate.validFrom && candidate.validFrom.getTime() > now.getTime()) {
    return false;
  }
  if (candidate.validUntil && candidate.validUntil.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

function selectCandidate(
  candidates: BillingEntitlementCandidate[],
  now: Date
): BillingEntitlementCandidate | null {
  return (
    candidates
      .filter(candidate => isCandidateActive(candidate, now))
      .sort((left, right) => {
        const priority = ACCESS_PRIORITY[left.reason] - ACCESS_PRIORITY[right.reason];
        if (priority !== 0) return priority;
        const leftExpiry = left.validUntil?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightExpiry = right.validUntil?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (leftExpiry !== rightExpiry) return rightExpiry - leftExpiry;
        return left.sourceId.localeCompare(right.sourceId);
      })[0] ?? null
  );
}

function allowedResult(
  candidate: BillingEntitlementCandidate,
  now: Date,
  sourceAvailable = true
): UserEntitlementsResult {
  return {
    allowed: true,
    reason: candidate.reason,
    ...(candidate.validUntil ? { validUntil: candidate.validUntil } : {}),
    ...(candidate.sponsorUserId
      ? { sponsorUserId: candidate.sponsorUserId }
      : {}),
    ...(candidate.planCode ? { planCode: candidate.planCode } : {}),
    entitlements: uniqueEntitlements(candidate.entitlements),
    sourceAvailable,
    evaluatedAt: now,
  };
}

function openAccessResult(
  now: Date,
  sourceAvailable: boolean
): UserEntitlementsResult {
  return {
    allowed: true,
    reason: "free_access" as const,
    entitlements: ["system_access"],
    sourceAvailable,
    evaluatedAt: now,
  };
}

function deniedResult(
  now: Date,
  sourceAvailable: boolean
): UserEntitlementsResult {
  return {
    allowed: false,
    reason: "no_access" as const,
    entitlements: [],
    sourceAvailable,
    evaluatedAt: now,
  };
}

export function createBillingService(deps: {
  repository: BillingRepository;
  accessMode?: () => BillingAccessMode;
  now?: () => Date;
  onWarning?: (scope: string, error: unknown) => void;
}) {
  const nowProvider = deps.now ?? (() => new Date());
  const modeProvider = deps.accessMode ?? getBillingAccessMode;
  const warning = deps.onWarning ?? (() => undefined);

  async function getUserEntitlements(
    userId: number
  ): Promise<UserEntitlementsResult> {
    const now = nowProvider();
    try {
      const selected = selectCandidate(
        await deps.repository.listAccessCandidates(userId, now),
        now
      );
      if (selected) return allowedResult(selected, now);
      return modeProvider() === "open_access"
        ? openAccessResult(now, true)
        : deniedResult(now, true);
    } catch (error) {
      warning("billing_entitlements", error);
      return modeProvider() === "open_access"
        ? openAccessResult(now, false)
        : deniedResult(now, false);
    }
  }

  async function userCanUseSystem(userId: number) {
    return (await getUserEntitlements(userId)).allowed;
  }

  async function getUserSubscriptionStatus(userId: number) {
    const access = await getUserEntitlements(userId);
    const evaluatedAt = nowProvider();
    try {
      const [subscription, professionalSubscription] = await Promise.all([
        deps.repository.getOwnSubscription(userId, evaluatedAt),
        deps.repository.getActiveProfessionalSubscription(userId, evaluatedAt),
      ]);
      return {
        access,
        subscription,
        professionalSubscription,
      };
    } catch (error) {
      warning("billing_subscription_status", error);
      return {
        access,
        subscription: null,
        professionalSubscription: null,
      };
    }
  }

  async function searchAdminUsers(input: {
    query: string;
    limit: number;
    accessReason?: BillingAccessReason;
  }): Promise<BillingAdminUserAccess[]> {
    const pageSize = input.accessReason ? Math.max(input.limit, 50) : input.limit;
    const matches: BillingAdminUserAccess[] = [];
    let offset = 0;

    while (matches.length < input.limit) {
      const users = await deps.repository.searchUsers(
        input.query,
        pageSize,
        offset
      );
      if (!users.length) break;

      const evaluatedAt = nowProvider();
      const evaluated = await Promise.all(
        users.map(async user => {
          const [access, activeOverride, ownSubscription] = await Promise.all([
            getUserEntitlements(user.id),
            deps.repository.getActiveAdminOverride(user.id, evaluatedAt),
            deps.repository.getOwnSubscription(user.id, evaluatedAt),
          ]);
          return { ...user, access, activeOverride, ownSubscription };
        })
      );
      matches.push(
        ...evaluated.filter(
          row => !input.accessReason || row.access.reason === input.accessReason
        )
      );

      offset += users.length;
      if (!input.accessReason || users.length < pageSize) break;
    }

    return matches.slice(0, input.limit);
  }

  function listAdminOverrides(userId: number, limit: number) {
    return deps.repository.listAdminOverrides(userId, limit, nowProvider());
  }

  async function grantAdminOverride(input: GrantBillingOverrideInput) {
    const startsAt = input.startsAt ?? nowProvider();
    if (input.endsAt && input.endsAt.getTime() <= startsAt.getTime()) {
      throw new Error("A vigência final deve ser posterior ao início da liberação.");
    }
    return deps.repository.grantAdminOverride({ ...input, startsAt });
  }

  function revokeAdminOverride(input: RevokeBillingOverrideInput) {
    return deps.repository.revokeAdminOverride(input);
  }

  function getAdminAnalytics() {
    return deps.repository.getAdminAnalytics(nowProvider());
  }

  return {
    getUserEntitlements,
    userCanUseSystem,
    getUserSubscriptionStatus,
    searchAdminUsers,
    listAdminOverrides,
    grantAdminOverride,
    revokeAdminOverride,
    getAdminAnalytics,
  };
}

export const billingRepository = createDrizzleBillingRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export const billingService = createBillingService({
  repository: billingRepository,
  onWarning: logPersistenceWarning,
});

export function getUserEntitlements(userId: number) {
  return billingService.getUserEntitlements(userId);
}

export function userCanUseSystem(userId: number) {
  return billingService.userCanUseSystem(userId);
}

export function getUserSubscriptionStatus(userId: number) {
  return billingService.getUserSubscriptionStatus(userId);
}

export { BillingPersistenceUnavailableError };
