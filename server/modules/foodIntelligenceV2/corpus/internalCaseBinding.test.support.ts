import type { CorpusCaseInput, GoldenCorpusCase } from "./contracts";

/**
 * Associação interna do harness. A referência dos testes pode localizar a
 * fixture que originou um objeto sem consultar nenhum campo da entrada pública.
 * O WeakMap não é exportado por nenhum barrel do corpus nem é acessível pelo
 * resolvedor sob teste através de `CorpusResolverRequest`.
 */
const BOUND_CASES = new WeakMap<object, string>();

export function bindCorpusCaseInput(
  input: CorpusCaseInput,
  source: GoldenCorpusCase
): void {
  BOUND_CASES.set(input, source.caseId);
}

export function lookupBoundCorpusCaseId(
  input: CorpusCaseInput
): string | undefined {
  return BOUND_CASES.get(input);
}
