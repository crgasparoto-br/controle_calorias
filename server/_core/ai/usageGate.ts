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

export function setAiUsageGate(gate: AiUsageGate | null): void {
  configuredUsageGate = gate;
}

export function getAiUsageGate(): AiUsageGate | null {
  return configuredUsageGate;
}

export async function enforceAiUsageGate(
  input: AiUsageGateInput,
): Promise<AiUsageGateResult | undefined> {
  if (!configuredUsageGate) return undefined;
  return (await configuredUsageGate(input)) ?? undefined;
}
