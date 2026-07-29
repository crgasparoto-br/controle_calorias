import { useSyncExternalStore } from "react";

type VisualAuthUser = {
  id: number;
  name: string;
  professionalProfileActive: boolean;
};

declare global {
  interface Window {
    __setVisualProfessionalProfileActive?: (active: boolean) => void;
  }
}

let professionalProfileActive = true;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function activeSnapshot() {
  return professionalProfileActive;
}

export function getVisualAuthUser(): VisualAuthUser {
  return {
    id: 1,
    name: "Nutricionista de validação",
    professionalProfileActive,
  };
}

export function setVisualProfessionalProfileActive(active: boolean) {
  if (professionalProfileActive === active) return;
  professionalProfileActive = active;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.__setVisualProfessionalProfileActive =
    setVisualProfessionalProfileActive;
}

export function useAuth() {
  const active = useSyncExternalStore(
    subscribe,
    activeSnapshot,
    activeSnapshot
  );
  return {
    loading: false,
    user: {
      id: 1,
      name: "Nutricionista de validação",
      professionalProfileActive: active,
    },
    refresh: async () => undefined,
  };
}
