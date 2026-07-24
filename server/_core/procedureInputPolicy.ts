import type {
  AuthenticatedTrpcContext,
} from "./procedurePolicy";

export type ProtectedProcedureInputPolicyInput = {
  path: string;
  ctx: AuthenticatedTrpcContext;
  input: unknown;
};

export type ProtectedProcedureInputPolicy = (
  input: ProtectedProcedureInputPolicyInput
) => unknown | Promise<unknown>;

const policies = new Set<ProtectedProcedureInputPolicy>();

export function registerProtectedProcedureInputPolicy(
  policy: ProtectedProcedureInputPolicy
) {
  policies.add(policy);
  return () => policies.delete(policy);
}

export async function enforceProtectedProcedureInputPolicies(
  input: ProtectedProcedureInputPolicyInput
) {
  let current = input.input;
  for (const policy of policies) {
    current = await policy({
      path: input.path,
      ctx: input.ctx,
      input: current,
    });
  }
  return current;
}

export function _forTestOnly_clearProtectedProcedureInputPolicies() {
  policies.clear();
}
