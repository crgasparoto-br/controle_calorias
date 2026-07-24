import type { AuthenticatedTrpcContext } from "./procedurePolicy";

export type ProtectedProcedureInputPolicyInput = {
  path: string;
  ctx: AuthenticatedTrpcContext;
  input: unknown;
};

export type ProtectedProcedureInputPolicy = (
  input: ProtectedProcedureInputPolicyInput
) => unknown | Promise<unknown>;

const policies = new Set<ProtectedProcedureInputPolicy>();

function asMutableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function registerProtectedProcedureInputPolicy(
  policy: ProtectedProcedureInputPolicy
) {
  policies.add(policy);
  return () => policies.delete(policy);
}

export async function enforceProtectedProcedureInputPolicies(
  input: ProtectedProcedureInputPolicyInput
) {
  const original = asMutableRecord(input.input);
  let current = input.input;
  for (const policy of policies) {
    current = await policy({
      path: input.path,
      ctx: input.ctx,
      input: current,
    });
  }

  const replacement = asMutableRecord(current);
  if (!original || !replacement || original === replacement) return current;

  for (const key of Object.keys(original)) {
    if (!(key in replacement)) delete original[key];
  }
  Object.assign(original, replacement);
  return original;
}

export function _forTestOnly_clearProtectedProcedureInputPolicies() {
  policies.clear();
}
