import { describe, expect, it } from "vitest";
import { AsaasUncertainOutcomeError } from "./client";
import { executeGuardedAsaasMutation } from "./mutationGuard";
import type {
  AsaasOperation,
  AsaasOperationStore,
} from "./operationStore";

function memoryStore(initialState: AsaasOperation["state"] = "prepared") {
  let operation: AsaasOperation | null = null;
  let preserveCreatedOnUnknown = false;
  const store: AsaasOperationStore = {
    async get() {
      return operation;
    },
    async prepare(input) {
      if (operation) return { operation, created: false };
      operation = {
        id: "op-1",
        kind: input.kind,
        operationKey: input.operationKey,
        state: initialState,
        subscriptionId: input.subscriptionId ?? null,
        externalId: null,
        externalReference: input.externalReference ?? null,
        customerReference: null,
        authorizationReference: null,
        publicReference: null,
        payerUserId: null,
        planCode: null,
        paymentMethod: null,
        trialChoice: null,
        couponCode: null,
        billingCycle: null,
        correlationId: null,
        amountMinor: null,
        unitAmountMinor: null,
        discountDurationCharges: null,
        transitionAccessUntil: null,
        dueDate: null,
        updatedAt: new Date(),
      };
      return { operation, created: true };
    },
    async markCreated(input) {
      if (!operation) throw new Error("missing");
      operation = {
        ...operation,
        state: "created",
        externalId: input.externalId,
        externalReference: input.externalReference ?? operation.externalReference,
      };
    },
    async bindSubscription(_kind, _operationKey, subscriptionId) {
      if (!operation) throw new Error("missing");
      operation = { ...operation, subscriptionId };
    },
    async markOutcomeUnknown() {
      if (!operation) throw new Error("missing");
      if (preserveCreatedOnUnknown) {
        operation = { ...operation, state: "created", externalId: "remote-1" };
        return;
      }
      if (operation.state !== "created") {
        operation = { ...operation, state: "outcome_unknown" };
      }
    },
    async resetOutcomeUnknownToPrepared() {
      if (!operation) throw new Error("missing");
      if (operation.state === "outcome_unknown") {
        operation = { ...operation, state: "prepared" };
      }
    },
    async markFailed() {
      if (!operation) throw new Error("missing");
      if (operation.state !== "created") operation = { ...operation, state: "failed" };
    },
    async countCouponCharges() {
      return 0;
    },
    async findByExternalId() {
      return null;
    },
    async findByPublicReference() {
      return null;
    },
    async listScheduledPixPayments() {
      return [];
    },
  };
  return {
    store,
    forceOutcomeUnknown() {
      if (!operation) throw new Error("not prepared");
      operation = { ...operation, state: "outcome_unknown" };
    },
    simulateConcurrentConfirmation() {
      preserveCreatedOnUnknown = true;
    },
  };
}

const inputBase = {
  operationKey: "cancel:sub-1:correlation-1",
  subscriptionId: "sub-1",
  contractKey: "contract-1",
};

describe("guarded Asaas provider mutation", () => {
  it("reconciles an uncertain outcome by GET-equivalent without repeating the mutation", async () => {
    const memory = memoryStore();
    let mutations = 0;
    let reconciliations = 0;
    await expect(
      executeGuardedAsaasMutation({
        ...inputBase,
        store: memory.store,
        action: async () => {
          mutations += 1;
          throw new AsaasUncertainOutcomeError();
        },
        reconcile: async () => ({ status: "pending" }),
      })
    ).rejects.toBeInstanceOf(AsaasUncertainOutcomeError);

    const result = await executeGuardedAsaasMutation({
      ...inputBase,
      store: memory.store,
      action: async () => {
        mutations += 1;
        return "should-not-run";
      },
      reconcile: async () => {
        reconciliations += 1;
        return { status: "applied", externalId: "remote-1" } as const;
      },
    });

    expect(result).toBe("reconciled");
    expect(mutations).toBe(1);
    expect(reconciliations).toBe(1);
  });

  it("does not regress a concurrent confirmed state after a late timeout", async () => {
    const memory = memoryStore();
    memory.simulateConcurrentConfirmation();

    const result = await executeGuardedAsaasMutation({
      ...inputBase,
      store: memory.store,
      action: async () => {
        throw new AsaasUncertainOutcomeError();
      },
      reconcile: async () => ({ status: "pending" }),
    });

    expect(result).toBe("reconciled");
    expect((await memory.store.get("reconciliation", inputBase.operationKey))?.state).toBe(
      "created"
    );
  });

  it("reopens an operation only after a read proves the remote effect was not applied", async () => {
    const memory = memoryStore();
    let mutations = 0;
    let reconciliations = 0;

    await expect(
      executeGuardedAsaasMutation({
        ...inputBase,
        store: memory.store,
        action: async () => {
          mutations += 1;
          throw new AsaasUncertainOutcomeError();
        },
        reconcile: async () => ({ status: "pending" }),
      })
    ).rejects.toBeInstanceOf(AsaasUncertainOutcomeError);

    await expect(
      executeGuardedAsaasMutation({
        ...inputBase,
        store: memory.store,
        action: async () => {
          mutations += 1;
          return "should-not-run-during-reconciliation";
        },
        reconcile: async () => {
          reconciliations += 1;
          return { status: "not_applied" } as const;
        },
      })
    ).rejects.toThrow("asaas_financial_operation_safe_retry_required");

    expect(mutations).toBe(1);
    expect(reconciliations).toBe(1);
    expect((await memory.store.get("reconciliation", inputBase.operationKey))?.state).toBe(
      "prepared"
    );

    const retried = await executeGuardedAsaasMutation({
      ...inputBase,
      store: memory.store,
      action: async () => {
        mutations += 1;
        return "remote-2";
      },
      reconcile: async () => ({ status: "pending" }),
    });
    expect(retried).toBe("created");
    expect(mutations).toBe(2);
  });
});
