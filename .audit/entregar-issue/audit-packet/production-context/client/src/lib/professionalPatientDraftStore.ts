export type ProfessionalPatientDraftScope = Readonly<{
  patientId: number;
  authorizationId: string;
}>;

const professionalPatientDraftSnapshots = new Map<string, unknown>();

function professionalPatientDraftKey(
  scope: ProfessionalPatientDraftScope | null | undefined
) {
  const authorizationId = scope?.authorizationId.trim();
  if (
    !scope ||
    !Number.isSafeInteger(scope.patientId) ||
    scope.patientId <= 0 ||
    !authorizationId
  ) {
    return null;
  }
  return `${authorizationId}:${scope.patientId}`;
}

export function readProfessionalPatientDraftSnapshot<T>(
  scope: ProfessionalPatientDraftScope | null | undefined,
  createEmpty: () => T
): T {
  const key = professionalPatientDraftKey(scope);
  if (!key) return createEmpty();
  const snapshot = professionalPatientDraftSnapshots.get(key);
  return snapshot === undefined ? createEmpty() : (snapshot as T);
}

export function storeProfessionalPatientDraftSnapshot<T>(
  scope: ProfessionalPatientDraftScope | null | undefined,
  snapshot: T
) {
  const key = professionalPatientDraftKey(scope);
  if (!key) return;
  professionalPatientDraftSnapshots.set(key, snapshot);
}

export function clearProfessionalPatientDraftSnapshot(
  scope: ProfessionalPatientDraftScope | null | undefined
) {
  const key = professionalPatientDraftKey(scope);
  if (key) professionalPatientDraftSnapshots.delete(key);
}

export function clearProfessionalPatientDraftsForAuthorization(
  authorizationId: string | null | undefined
) {
  const normalized = authorizationId?.trim();
  if (!normalized) return;
  const prefix = `${normalized}:`;
  for (const key of professionalPatientDraftSnapshots.keys()) {
    if (key.startsWith(prefix)) {
      professionalPatientDraftSnapshots.delete(key);
    }
  }
}

export function clearAllProfessionalPatientDraftSnapshots() {
  professionalPatientDraftSnapshots.clear();
}
