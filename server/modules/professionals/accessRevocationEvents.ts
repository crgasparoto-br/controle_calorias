export type ProfessionalAccessRevokedEvent = {
  type: "access_revoked";
  professionalUserId: number;
  patientUserId: number;
  authorizationId: string;
  occurredAt: number;
};

type ProfessionalAccessRevokedListener = (
  event: ProfessionalAccessRevokedEvent
) => void;

const listeners = new Map<string, Set<ProfessionalAccessRevokedListener>>();

function listenerKey(professionalUserId: number, patientUserId: number) {
  return `${professionalUserId}:${patientUserId}`;
}

export function subscribeProfessionalAccessRevocations(
  professionalUserId: number,
  patientUserId: number,
  listener: ProfessionalAccessRevokedListener
) {
  const key = listenerKey(professionalUserId, patientUserId);
  const patientListeners = listeners.get(key) ?? new Set();
  patientListeners.add(listener);
  listeners.set(key, patientListeners);

  return () => {
    patientListeners.delete(listener);
    if (!patientListeners.size) listeners.delete(key);
  };
}

export function publishProfessionalAccessRevoked(
  event: ProfessionalAccessRevokedEvent
) {
  const patientListeners = listeners.get(
    listenerKey(event.professionalUserId, event.patientUserId)
  );
  if (!patientListeners) return;

  for (const listener of [...patientListeners]) {
    try {
      listener(event);
    } catch {
      // A delivery failure must not roll back the already-persisted revocation.
    }
  }
}

export function _forTestOnly_clearProfessionalAccessRevocationListeners() {
  listeners.clear();
}
