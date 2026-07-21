import type { TrpcContext } from "./context";

export type AuthenticatedTrpcContext = TrpcContext & {
  user: NonNullable<TrpcContext["user"]>;
};

export type ProtectedProcedurePolicyInput = {
  path: string;
  ctx: AuthenticatedTrpcContext;
};

export type ProtectedProcedurePolicy = (
  input: ProtectedProcedurePolicyInput
) => Promise<void> | void;

const policies = new Set<ProtectedProcedurePolicy>();

export function registerProtectedProcedurePolicy(
  policy: ProtectedProcedurePolicy
) {
  policies.add(policy);
  return () => policies.delete(policy);
}

export async function enforceProtectedProcedurePolicies(
  input: ProtectedProcedurePolicyInput
) {
  for (const policy of policies) await policy(input);
}

export function _forTestOnly_clearProtectedProcedurePolicies() {
  policies.clear();
}
