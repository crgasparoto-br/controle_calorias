import { AsyncLocalStorage } from "node:async_hooks";

export type WhatsappContextFlow = "text" | "image" | "audio" | "multimodal";
export type WhatsappContextReadMode = "legacy" | "write_only" | "shadow" | "persistent";

export type WhatsappContextTurn = {
  direction: "inbound" | "outbound";
  text: string | null;
  occurredAtIso: string;
};

export type WhatsappContextSelection = {
  mode: WhatsappContextReadMode;
  flow: WhatsappContextFlow;
  source: "legacy" | "persistent";
  turns: WhatsappContextTurn[];
  persistentEligible: boolean;
  equivalent: boolean | null;
  legacyCount: number;
  persistentCount: number;
};

const flowStorage = new AsyncLocalStorage<WhatsappContextFlow>();

function parseMode(value: string | undefined): WhatsappContextReadMode | null {
  return value === "legacy" || value === "write_only" || value === "shadow" || value === "persistent"
    ? value
    : null;
}

function parsePercentage(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function flowEnvKey(prefix: string, flow: WhatsappContextFlow) {
  return `${prefix}_${flow.toUpperCase()}`;
}

function deterministicBucket(userId: number, flow: WhatsappContextFlow) {
  const value = `${userId}:${flow}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function turnSignature(turn: WhatsappContextTurn) {
  return `${turn.direction}:${turn.text ?? ""}`;
}

function contextsEquivalent(left: WhatsappContextTurn[], right: WhatsappContextTurn[]) {
  if (left.length !== right.length) return false;
  return left.every((turn, index) => turnSignature(turn) === turnSignature(right[index]));
}

export function getActiveWhatsappContextFlow(defaultFlow: WhatsappContextFlow = "text") {
  return flowStorage.getStore() ?? defaultFlow;
}

export async function withWhatsappContextFlow<T>(flow: WhatsappContextFlow, operation: () => Promise<T>): Promise<T> {
  return flowStorage.run(flow, operation);
}

export function resolveWhatsappContextRollout(flow: WhatsappContextFlow, userId: number) {
  const flowMode = parseMode(process.env[flowEnvKey("WHATSAPP_CONTEXT_READ_MODE", flow)]);
  const globalMode = parseMode(process.env.WHATSAPP_CONTEXT_READ_MODE);
  const mode = flowMode ?? globalMode ?? "write_only";

  const percentage = parsePercentage(
    process.env[flowEnvKey("WHATSAPP_CONTEXT_ROLLOUT_PERCENT", flow)]
      ?? process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT,
  );
  const persistentEligible = deterministicBucket(userId, flow) < percentage;
  return { mode, percentage, persistentEligible };
}

export function selectWhatsappConversationContext(input: {
  userId: number;
  flow: WhatsappContextFlow;
  legacyTurns: WhatsappContextTurn[];
  persistentTurns: WhatsappContextTurn[];
}): WhatsappContextSelection {
  const rollout = resolveWhatsappContextRollout(input.flow, input.userId);
  const equivalent = input.persistentTurns.length > 0
    ? contextsEquivalent(input.legacyTurns, input.persistentTurns)
    : null;
  const canUsePersistent = rollout.persistentEligible && input.persistentTurns.length > 0;
  const source = rollout.mode === "persistent" && canUsePersistent ? "persistent" : "legacy";

  return {
    mode: rollout.mode,
    flow: input.flow,
    source,
    turns: source === "persistent" ? input.persistentTurns : input.legacyTurns,
    persistentEligible: rollout.persistentEligible,
    equivalent,
    legacyCount: input.legacyTurns.length,
    persistentCount: input.persistentTurns.length,
  };
}
