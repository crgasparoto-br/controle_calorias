import { describe, expect, it } from "vitest";
import { createAsaasClient } from "./client";
import type { AsaasOperation, AsaasOperationStore } from "./operationStore";
import {
  readAsaasPixAuthorizationOutcome,
  reconcileAsaasPixAuthorizationOperation,
} from "./pixAuthorizationRecovery";

function operation(overrides: Partial<AsaasOperation> = {}): AsaasOperation {
  return {
    id: "op-pix-1",
    kind: "pix_automatic_authorization",
    operationKey: "contract-1:pix-automatic",
    state: "outcome_unknown",
    subscriptionId: "sub-1",
    externalId: null,
    externalReference: "contract-1",
    customerReference: "cus-1",
    authorizationReference: null,
    publicReference: "contract-hash-1",
    payerUserId: 7,
    planCode: "individual-monthly-v1",
    paymentMethod: "pix_automatic",
    trialChoice: "waive",
    couponCode: null,
    billingCycle: "monthly",
    correlationId: "attempt-1",
    amountMinor: 3990,
    unitAmountMinor: 3990,
    discountDurationCharges: null,
    transitionAccessUntil: null,
    dueDate: null,
    updatedAt: new Date("2026-08-12T12:00:00.000Z"),
    ...overrides,
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Asaas Pix Automático uncertain authorization recovery", () => {
  it("PIX-AUTH-UNKNOWN-RECONCILE-001 finds the remote authorization with exactly one GET", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (request, init) => {
      calls += 1;
      expect(init?.method).toBe("GET");
      const url = new URL(String(request));
      expect(url.pathname).toBe("/v3/pix/automatic/authorizations");
      expect(url.searchParams.get("customerId")).toBe("cus-1");
      expect(url.searchParams.get("limit")).toBe("100");
      return jsonResponse({
        data: [
          {
            id: "aut-remote-1",
            status: "CREATED",
            customerId: "cus-1",
            contractId: "contract-hash-1",
            immediateQrCode: {
              conciliationIdentifier: "CID-RECOVERED-1",
            },
          },
        ],
        hasMore: false,
      });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await expect(
      readAsaasPixAuthorizationOutcome({ client, operation: operation() })
    ).resolves.toEqual({
      status: "reconciled",
      externalId: "aut-remote-1",
      remoteStatus: "CREATED",
      conciliationIdentifier: "CID-RECOVERED-1",
    });
    expect(calls).toBe(1);
  });



  it("PIX-AUTH-UNKNOWN-PERSIST-001 closes the local ledger after one authoritative GET and then reuses it with zero extra calls", async () => {
    let calls = 0;
    let current = operation();
    const store = {
      async markCreated(input: { externalId: string; authorizationReference?: string | null }) {
        current = {
          ...current,
          state: "created",
          externalId: input.externalId,
          authorizationReference: input.authorizationReference ?? current.authorizationReference,
        };
      },
    } as unknown as AsaasOperationStore;
    const fetchImpl: typeof fetch = async (_request, init) => {
      calls += 1;
      expect(init?.method).toBe("GET");
      return jsonResponse({
        data: [
          {
            id: "aut-persisted-1",
            status: "PENDING",
            customerId: "cus-1",
            contractId: "contract-hash-1",
          },
        ],
        hasMore: false,
      });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await expect(
      reconcileAsaasPixAuthorizationOperation({ client, store, operation: current })
    ).resolves.toMatchObject({ status: "reconciled", externalId: "aut-persisted-1" });
    expect(current).toMatchObject({
      state: "created",
      externalId: "aut-persisted-1",
      authorizationReference: "aut-persisted-1",
    });
    expect(calls).toBe(1);

    await expect(
      reconcileAsaasPixAuthorizationOperation({ client, store, operation: current })
    ).resolves.toEqual({ status: "reused", externalId: "aut-persisted-1" });
    expect(calls).toBe(1);
  });

  it("PIX-AUTH-UNKNOWN-NEG-001 keeps zero matches pending without a provider mutation", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_request, init) => {
      calls += 1;
      expect(init?.method).toBe("GET");
      return jsonResponse({ data: [], hasMore: false });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await expect(
      readAsaasPixAuthorizationOutcome({ client, operation: operation() })
    ).resolves.toEqual({ status: "pending", reason: "not_found" });
    expect(calls).toBe(1);
  });

  it("PIX-AUTH-UNKNOWN-PAGE-001 stays pending when the first page cannot prove absence", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_request, init) => {
      calls += 1;
      expect(init?.method).toBe("GET");
      return jsonResponse({ data: [], hasMore: true });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await expect(
      readAsaasPixAuthorizationOutcome({ client, operation: operation() })
    ).resolves.toEqual({
      status: "pending",
      reason: "not_found_first_page",
    });
    expect(calls).toBe(1);
  });

  it("PIX-AUTH-UNKNOWN-AMBIGUOUS-001 refuses multiple matches without a provider mutation", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_request, init) => {
      calls += 1;
      expect(init?.method).toBe("GET");
      return jsonResponse({
        data: [
          {
            id: "aut-a",
            status: "CREATED",
            customerId: "cus-1",
            contractId: "contract-hash-1",
          },
          {
            id: "aut-b",
            status: "ACTIVE",
            customerId: "cus-1",
            contractId: "contract-hash-1",
          },
        ],
        hasMore: false,
      });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await expect(
      readAsaasPixAuthorizationOutcome({ client, operation: operation() })
    ).rejects.toThrow("asaas_pix_authorization_reconciliation_ambiguous");
    expect(calls).toBe(1);
  });

  it("PIX-AUTH-UNKNOWN-TERMINAL-001 recognizes a terminal remote authorization by read only", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_request, init) => {
      calls += 1;
      expect(init?.method).toBe("GET");
      return jsonResponse({
        data: [
          {
            id: "aut-refused",
            status: "REFUSED",
            customerId: "cus-1",
            contractId: "contract-hash-1",
          },
        ],
        hasMore: false,
      });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await expect(
      readAsaasPixAuthorizationOutcome({ client, operation: operation() })
    ).resolves.toEqual({
      status: "terminal",
      externalId: "aut-refused",
      remoteStatus: "REFUSED",
      conciliationIdentifier: null,
    });
    expect(calls).toBe(1);
  });

  it("OUTBOUND-COUNT-001 performs zero network calls when the operation is already resolved", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ data: [] });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await expect(
      readAsaasPixAuthorizationOutcome({
        client,
        operation: operation({ state: "created", externalId: "aut-known" }),
      })
    ).resolves.toEqual({ status: "reused", externalId: "aut-known" });
    expect(calls).toBe(0);
  });
});
