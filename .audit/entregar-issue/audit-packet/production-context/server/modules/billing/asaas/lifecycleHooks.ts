import type { BillingProviderLifecycleHooks } from "../providerLifecycleHooks";
import type { AsaasCreditCardSchedule } from "./creditCardSchedule";
import type { AsaasOperationKind, AsaasOperationStore } from "./operationStore";

export type AsaasLifecycleHookRuntime = {
  store: AsaasOperationStore;
  creditCardSchedule: AsaasCreditCardSchedule;
};

export function createAsaasLifecycleHooks(
  getRuntime: () => AsaasLifecycleHookRuntime
): BillingProviderLifecycleHooks {
  return {
    async afterStartContract(input, result) {
      if (
        !result.ok ||
        input.paymentMethod !== "credit_card" ||
        input.trialChoice !== "request"
      ) {
        return;
      }
      const externalSubscriptionId = input.verifiedPaymentInstrument?.registrationId;
      const firstChargeAt = result.snapshot.firstChargeAt;
      const billingCycle = result.snapshot.billingCycle;
      if (
        !externalSubscriptionId ||
        !firstChargeAt ||
        (billingCycle !== "monthly" && billingCycle !== "yearly")
      ) {
        throw new Error("asaas_trial_schedule_context_missing");
      }

      const runtime = getRuntime();
      const checkout = await runtime.store.get(
        "checkout",
        `${input.contractKey}:checkout`
      );
      if (
        !checkout ||
        (checkout.subscriptionId && checkout.subscriptionId !== result.intent.subscriptionId) ||
        !checkout.amountMinor
      ) {
        throw new Error("asaas_trial_checkout_context_missing");
      }

      await runtime.creditCardSchedule.alignCreditCardSubscriptionSchedule({
        subscriptionId: result.intent.subscriptionId,
        externalSubscriptionId,
        contractKey: input.contractKey,
        scopeKey: "trial-start",
        billingCycle,
        targetDueDate: firstChargeAt.toISOString().slice(0, 10),
        amountMinor: checkout.amountMinor,
        paymentExternalReference: input.contractKey,
      });
    },

    async enrichFinancialFact(input) {
      if (
        input.chargePurpose !== "early_conversion" ||
        !input.competenceKey ||
        input.commercialConfirmationKey
      ) {
        return input;
      }
      const operation = await getRuntime().store.findByExternalId(
        "payment_reschedule" as AsaasOperationKind,
        input.competenceKey
      );
      if (
        !operation ||
        operation.subscriptionId !== input.subscriptionId ||
        !operation.correlationId
      ) {
        return input;
      }
      return {
        ...input,
        commercialConfirmationKey: operation.correlationId,
      };
    },
  };
}
