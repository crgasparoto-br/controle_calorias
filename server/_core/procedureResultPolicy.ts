import type { AuthenticatedTrpcContext } from "./procedurePolicy";

export type ProtectedProcedureResultPolicyInput = {
  path: string;
  result: unknown;
  ctx: AuthenticatedTrpcContext;
  input: unknown;
};

export type ProtectedProcedureResultPolicy = (
  input: ProtectedProcedureResultPolicyInput
) => unknown | Promise<unknown>;

const policies = new Set<ProtectedProcedureResultPolicy>();

export function registerProtectedProcedureResultPolicy(
  policy: ProtectedProcedureResultPolicy
) {
  policies.add(policy);
  return () => policies.delete(policy);
}

export async function enforceProtectedProcedureResultPolicies<T>(input: {
  path: string;
  result: T;
  ctx: AuthenticatedTrpcContext;
  input: unknown;
}): Promise<T> {
  let current: unknown = input.result;
  for (const policy of policies) {
    current = await policy({
      path: input.path,
      result: current,
      ctx: input.ctx,
      input: input.input,
    });
  }
  return current as T;
}

export function _forTestOnly_clearProtectedProcedureResultPolicies() {
  policies.clear();
}
