export const PROFESSIONAL_PROFILE_PREFERENCE_KEY = "professional_profile_v1";
export const PROFESSIONAL_ACCESSES_PREFERENCE_KEY = "professional_accesses_v1";
export const PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY =
  "patient_professional_access_requests_v1";

export type ProfessionalAuthorizationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked";
export type ProfessionalTrackingStatus = "active" | "paused" | "ended";
export type ProfessionalAccessResponseOrigin = "web" | "whatsapp";
export type ProfessionalAccessResponseDecision =
  | "approved"
  | "rejected"
  | "revoked";
export type ProfessionalAuthorizationMessageStatus =
  | "sent"
  | "failed"
  | "skipped";

export type CanonicalProfessionalProfile = {
  userId: number;
  displayName: string;
  registrationNumber?: string;
  active: boolean;
  sourceUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CanonicalProfessionalAuthorization = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  status: ProfessionalAuthorizationStatus;
  activePairKey: string | null;
  reason: string;
  requestedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  revokedAt: Date | null;
  respondedAt: Date | null;
  responseOrigin: ProfessionalAccessResponseOrigin | null;
  responseDecision: ProfessionalAccessResponseDecision | null;
  authorizationMessageStatus: ProfessionalAuthorizationMessageStatus | null;
  authorizationMessageSentAt: Date | null;
  authorizationMessageError: string | null;
  sourceUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CanonicalProfessionalTracking = {
  id: string;
  authorizationId: string;
  professionalUserId: number;
  patientUserId: number;
  status: ProfessionalTrackingStatus;
  startedAt: Date;
  pausedAt: Date | null;
  endedAt: Date | null;
  lastTransitionAt: Date;
  lastTransitionByUserId: number | null;
  lastTransitionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyProfessionalAccess = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  status: ProfessionalAuthorizationStatus;
  reason: string;
  requestedAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
  rejectedAt: number | null;
  respondedAt: number | null;
  responseOrigin: ProfessionalAccessResponseOrigin | null;
  responseDecision: ProfessionalAccessResponseDecision | null;
  authorizationMessageStatus: ProfessionalAuthorizationMessageStatus | null;
  authorizationMessageSentAt: number | null;
  authorizationMessageError: string | null;
  sourceUpdatedAt: number | null;
};

export type LegacyParseResult<T> = {
  value: T | null;
  issue: "invalid_json" | "invalid_shape" | null;
};

function isAuthorizationStatus(
  value: unknown
): value is ProfessionalAuthorizationStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "revoked"
  );
}

function isResponseOrigin(
  value: unknown
): value is ProfessionalAccessResponseOrigin {
  return value === "web" || value === "whatsapp";
}

function isResponseDecision(
  value: unknown
): value is ProfessionalAccessResponseDecision {
  return value === "approved" || value === "rejected" || value === "revoked";
}

function isAuthorizationMessageStatus(
  value: unknown
): value is ProfessionalAuthorizationMessageStatus {
  return value === "sent" || value === "failed" || value === "skipped";
}

function optionalTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function parseLegacyProfessionalProfile(
  userId: number,
  value: string,
  sourceUpdatedAt: Date
): LegacyParseResult<CanonicalProfessionalProfile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { value: null, issue: "invalid_json" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { value: null, issue: "invalid_shape" };
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.userId !== userId ||
    typeof candidate.displayName !== "string" ||
    candidate.displayName.trim().length === 0 ||
    typeof candidate.active !== "boolean"
  ) {
    return { value: null, issue: "invalid_shape" };
  }

  const createdAtMs =
    optionalTimestamp(candidate.createdAt) ?? sourceUpdatedAt.getTime();
  const updatedAtMs =
    optionalTimestamp(candidate.updatedAt) ?? sourceUpdatedAt.getTime();
  return {
    value: {
      userId,
      displayName: candidate.displayName.trim(),
      registrationNumber:
        typeof candidate.registrationNumber === "string" &&
        candidate.registrationNumber.trim()
          ? candidate.registrationNumber.trim()
          : undefined,
      active: candidate.active,
      sourceUpdatedAt,
      createdAt: new Date(createdAtMs),
      updatedAt: new Date(updatedAtMs),
    },
    issue: null,
  };
}

function normalizeLegacyAccess(
  value: unknown
): LegacyProfessionalAccess | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    candidate.id.length > 64 ||
    typeof candidate.professionalUserId !== "number" ||
    typeof candidate.patientUserId !== "number" ||
    !isAuthorizationStatus(candidate.status) ||
    typeof candidate.reason !== "string" ||
    optionalTimestamp(candidate.requestedAt) === null
  ) {
    return null;
  }

  return {
    id: candidate.id,
    professionalUserId: candidate.professionalUserId,
    patientUserId: candidate.patientUserId,
    status: candidate.status,
    reason: candidate.reason,
    requestedAt: candidate.requestedAt as number,
    approvedAt: optionalTimestamp(candidate.approvedAt),
    revokedAt: optionalTimestamp(candidate.revokedAt),
    rejectedAt: optionalTimestamp(candidate.rejectedAt),
    respondedAt: optionalTimestamp(candidate.respondedAt),
    responseOrigin: isResponseOrigin(candidate.responseOrigin)
      ? candidate.responseOrigin
      : null,
    responseDecision: isResponseDecision(candidate.responseDecision)
      ? candidate.responseDecision
      : null,
    authorizationMessageStatus: isAuthorizationMessageStatus(
      candidate.authorizationMessageStatus
    )
      ? candidate.authorizationMessageStatus
      : null,
    authorizationMessageSentAt: optionalTimestamp(
      candidate.authorizationMessageSentAt
    ),
    authorizationMessageError:
      typeof candidate.authorizationMessageError === "string"
        ? candidate.authorizationMessageError.slice(0, 500)
        : null,
    sourceUpdatedAt: optionalTimestamp(candidate.sourceUpdatedAt),
  };
}

export function parseLegacyProfessionalAccesses(
  ownerUserId: number,
  preferenceKey: string,
  value: string
): LegacyParseResult<LegacyProfessionalAccess[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { value: null, issue: "invalid_json" };
  }

  if (!Array.isArray(parsed)) {
    return { value: null, issue: "invalid_shape" };
  }

  const accesses = parsed
    .map(normalizeLegacyAccess)
    .filter((access): access is LegacyProfessionalAccess => Boolean(access))
    .filter(access =>
      preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
        ? access.professionalUserId === ownerUserId
        : access.patientUserId === ownerUserId
    );

  return {
    value: accesses,
    issue: accesses.length === parsed.length ? null : "invalid_shape",
  };
}

export function getAuthorizationActivePairKey(input: {
  professionalUserId: number;
  patientUserId: number;
  status: ProfessionalAuthorizationStatus;
}) {
  return input.status === "pending" || input.status === "approved"
    ? `${input.professionalUserId}:${input.patientUserId}`
    : null;
}

export function getLegacyAuthorizationSourceUpdatedAt(
  access: LegacyProfessionalAccess
) {
  const version = Math.max(
    access.sourceUpdatedAt ?? 0,
    access.requestedAt,
    access.approvedAt ?? 0,
    access.rejectedAt ?? 0,
    access.revokedAt ?? 0,
    access.respondedAt ?? 0,
    access.authorizationMessageSentAt ?? 0
  );
  return new Date(version);
}

export function legacyAccessToCanonical(
  access: LegacyProfessionalAccess,
  _legacyRowUpdatedAt?: Date
): Omit<CanonicalProfessionalAuthorization, "createdAt" | "updatedAt"> {
  const sourceUpdatedAt = getLegacyAuthorizationSourceUpdatedAt(access);
  return {
    id: access.id,
    professionalUserId: access.professionalUserId,
    patientUserId: access.patientUserId,
    status: access.status,
    activePairKey: getAuthorizationActivePairKey(access),
    reason: access.reason,
    requestedAt: new Date(access.requestedAt),
    approvedAt: access.approvedAt ? new Date(access.approvedAt) : null,
    rejectedAt: access.rejectedAt ? new Date(access.rejectedAt) : null,
    revokedAt: access.revokedAt ? new Date(access.revokedAt) : null,
    respondedAt: access.respondedAt ? new Date(access.respondedAt) : null,
    responseOrigin: access.responseOrigin,
    responseDecision: access.responseDecision,
    authorizationMessageStatus: access.authorizationMessageStatus,
    authorizationMessageSentAt: access.authorizationMessageSentAt
      ? new Date(access.authorizationMessageSentAt)
      : null,
    authorizationMessageError: access.authorizationMessageError,
    sourceUpdatedAt,
  };
}

export function canonicalAuthorizationToLegacy(
  authorization: Pick<
    CanonicalProfessionalAuthorization,
    | "id"
    | "professionalUserId"
    | "patientUserId"
    | "status"
    | "reason"
    | "requestedAt"
    | "approvedAt"
    | "revokedAt"
    | "rejectedAt"
    | "respondedAt"
    | "responseOrigin"
    | "responseDecision"
    | "authorizationMessageStatus"
    | "authorizationMessageSentAt"
    | "authorizationMessageError"
    | "sourceUpdatedAt"
  >
): LegacyProfessionalAccess {
  return {
    ...authorization,
    requestedAt: authorization.requestedAt.getTime(),
    approvedAt: authorization.approvedAt?.getTime() ?? null,
    revokedAt: authorization.revokedAt?.getTime() ?? null,
    rejectedAt: authorization.rejectedAt?.getTime() ?? null,
    respondedAt: authorization.respondedAt?.getTime() ?? null,
    authorizationMessageSentAt:
      authorization.authorizationMessageSentAt?.getTime() ?? null,
    sourceUpdatedAt: authorization.sourceUpdatedAt.getTime(),
  };
}

export function canTransitionProfessionalTracking(
  current: ProfessionalTrackingStatus,
  next: ProfessionalTrackingStatus
) {
  if (current === next) return true;
  if (current === "active") return next === "paused" || next === "ended";
  if (current === "paused") return next === "active" || next === "ended";
  return false;
}

export function assertProfessionalTrackingTransition(
  current: ProfessionalTrackingStatus,
  next: ProfessionalTrackingStatus
) {
  if (!canTransitionProfessionalTracking(current, next)) {
    throw new Error(
      `Transição de acompanhamento inválida: ${current} -> ${next}.`
    );
  }
}
