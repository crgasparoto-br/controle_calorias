import type { AiCapabilityId } from "./capabilities";
import type { AiObservabilityOrigin } from "./observability";

export type AiUsageGateInput = {
  userId: number;
  capability: AiCapabilityId;
  origin?: AiObservabilityOrigin;
  flow?: string;
  conversationId?: string | null;
};

export type AiUsageGateResult = {
  correlation?: Record<string, string | number | boolean | null>;
};

export type AiUsageGate = (
  input: AiUsageGateInput,
) => Promise<AiUsageGateResult | void>;

let configuredUsageGate: AiUsageGate | null = null;
let configuredUsageDurationObserver: ((durationMs: number) => void) | null = null;

export function setAiUsageGate(gate: AiUsageGate | null): void {
  configuredUsageGate = gate;
}

export function getAiUsageGate(): AiUsageGate | null {
  return configuredUsageGate;
}

export function setAiUsageDurationObserver(observer: ((durationMs: number) => void) | null): void {
  configuredUsageDurationObserver = observer;
}

export async function measureAiUsageGovernanceOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (!configuredUsageDurationObserver) return operation();
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    configuredUsageDurationObserver(Math.max(0, performance.now() - startedAt));
  }
}

export async function enforceAiUsageGate(
  input: AiUsageGateInput,
): Promise<AiUsageGateResult | undefined> {
  if (!configuredUsageGate) return undefined;
  return (await measureAiUsageGovernanceOperation(() => configuredUsageGate!(input))) ?? undefined;
}
