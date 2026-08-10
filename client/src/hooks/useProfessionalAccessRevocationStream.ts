import { useEffect } from "react";
import type { ProfessionalPatientRouteEntitlement } from "@/lib/professionalRoutes";

type RevocationPayload = {
  patientId: number;
  occurredAt: number;
};

export function useProfessionalAccessRevocationStream(input: {
  enabled: boolean;
  patientId: number | null;
  resource: ProfessionalPatientRouteEntitlement | null;
  onRevoked: (payload: RevocationPayload) => void;
}) {
  const { enabled, onRevoked, patientId, resource } = input;

  useEffect(() => {
    if (
      !enabled ||
      !patientId ||
      !resource ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }

    const query = new URLSearchParams({
      patientId: String(patientId),
      resource,
    });
    const source = new window.EventSource(
      `/api/professional/access-events?${query.toString()}`,
      { withCredentials: true }
    );
    const handleRevocation = (event: Event) => {
      if (!(event instanceof MessageEvent)) return;
      try {
        const payload = JSON.parse(event.data) as Partial<RevocationPayload>;
        if (
          payload.patientId === patientId &&
          typeof payload.occurredAt === "number"
        ) {
          onRevoked({ patientId, occurredAt: payload.occurredAt });
        }
      } catch {
        // Ignore malformed transport events. Canonical refetch remains fail-closed.
      }
    };

    source.addEventListener("access_revoked", handleRevocation);
    return () => {
      source.removeEventListener("access_revoked", handleRevocation);
      source.close();
    };
  }, [enabled, onRevoked, patientId, resource]);
}
