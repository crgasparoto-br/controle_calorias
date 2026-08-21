import { AsaasUncertainOutcomeError } from "./client";
import type { AsaasOperationStore } from "./operationStore";

export type AsaasMutationReconciliationResult =
  | { status: "applied"; externalId: string }
  | { status: "not_applied" }
  | { status: "pending" };

export async function executeGuardedAsaasMutation(input: {
  store: AsaasOperationStore;
  operationKey: string;
  subscriptionId: string;
  contractKey: string;
  action: () => Promise<string>;
  reconcile: () => Promise<AsaasMutationReconciliationResult>;
}) {
  const prepared = await input.store.prepare({
    kind: "reconciliation",
    operationKey: input.operationKey,
    subscriptionId: input.subscriptionId,
    externalReference: input.contractKey,
  });
  if (prepared.operation.state === "created") return "reused" as const;
  if (prepared.operation.state === "outcome_unknown") {
    const reconciliation = await input.reconcile();
    if (reconciliation.status === "applied") {
      await input.store.markCreated({
        kind: "reconciliation",
        operationKey: input.operationKey,
        externalId: reconciliation.externalId,
        externalReference: input.contractKey,
      });
      return "reconciled" as const;
    }
    if (reconciliation.status === "not_applied") {
      await input.store.resetOutcomeUnknownToPrepared(
        "reconciliation",
        input.operationKey
      );
      throw new Error("asaas_financial_operation_safe_retry_required");
    }
    throw new Error("asaas_financial_operation_reconciliation_pending");
  }
  if (!prepared.created && prepared.operation.state === "failed") {
    throw new Error("asaas_financial_operation_failed");
  }
  try {
    const externalId = await input.action();
    await input.store.markCreated({
      kind: "reconciliation",
      operationKey: input.operationKey,
      externalId,
      externalReference: input.contractKey,
    });
    return "created" as const;
  } catch (error) {
    if (error instanceof AsaasUncertainOutcomeError) {
      await input.store.markOutcomeUnknown("reconciliation", input.operationKey);
      const latest = await input.store.get("reconciliation", input.operationKey);
      if (latest?.state === "created") return "reconciled" as const;
    } else {
      await input.store.markFailed(
        "reconciliation",
        input.operationKey,
        "provider_mutation_failed"
      );
    }
    throw error;
  }
}
