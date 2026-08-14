import type {
  BillingStartContractInput,
} from "./subscriptionLifecycle";
import type {
  BillingPrepareContractResult,
  BillingProviderNeutralFinancialFact,
} from "./subscriptionLifecycleTypes";

export type BillingProviderLifecycleHooks = {
  afterStartContract?: (
    input: BillingStartContractInput,
    result: BillingPrepareContractResult
  ) => Promise<void>;
  enrichFinancialFact?: (
    input: BillingProviderNeutralFinancialFact
  ) => Promise<BillingProviderNeutralFinancialFact>;
};

const hooks = new Map<string, BillingProviderLifecycleHooks>();

export function configureBillingProviderLifecycleHooks(
  providerCode: string,
  value: BillingProviderLifecycleHooks
) {
  const key = providerCode.trim().toLowerCase();
  if (!key) throw new Error("billing_provider_hook_code_required");
  hooks.set(key, value);
}

export async function runBillingProviderAfterStartContract(
  input: BillingStartContractInput,
  result: BillingPrepareContractResult
) {
  const hook = hooks.get(input.providerCode.trim().toLowerCase())?.afterStartContract;
  if (hook) await hook(input, result);
}

export async function enrichBillingProviderFinancialFact(
  input: BillingProviderNeutralFinancialFact
) {
  const hook = hooks.get(input.providerCode.trim().toLowerCase())?.enrichFinancialFact;
  return hook ? hook(input) : input;
}
