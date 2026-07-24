export type ProtectedProcedureResultPolicyInput = {
  path: string;
  result: unknown;
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
}): Promise<T> {
  let current: unknown = input.result;
  for (const policy of policies) {
    current = await policy({ path: input.path, result: current });
  }
  return current as T;
}

export function _forTestOnly_clearProtectedProcedureResultPolicies() {
  policies.clear();
}
