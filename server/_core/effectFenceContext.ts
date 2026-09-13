import { AsyncLocalStorage } from "node:async_hooks";

type IrreversibleEffectFence = {
  beforeEffect: () => void | Promise<void>;
};

const irreversibleEffectFence = new AsyncLocalStorage<IrreversibleEffectFence>();

/**
 * Instala um fence request-scoped para efeitos irreversíveis/externos. Fora de
 * um fluxo que possua ownership persistente, o boundary permanece transparente.
 */
export function runWithIrreversibleEffectFence<T>(
  beforeEffect: IrreversibleEffectFence["beforeEffect"],
  operation: () => T,
): T {
  return irreversibleEffectFence.run({ beforeEffect }, operation);
}

/** Revalida a autoridade imediatamente antes de um efeito material. */
export async function ensureCurrentIrreversibleEffectAllowed() {
  await irreversibleEffectFence.getStore()?.beforeEffect();
}
