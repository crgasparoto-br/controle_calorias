import { describe, expect, it } from "vitest";
import { createAsaasClient } from "./client";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Asaas client Pix Automático serialization", () => {
  it("serializes yearly authorization frequency as ANNUALLY on the wire", async () => {
    let body: Record<string, unknown> | null = null;
    let calls = 0;
    const fetchImpl: typeof fetch = async (request, init) => {
      calls += 1;
      expect(String(request)).toBe(
        "https://api-sandbox.asaas.com/v3/pix/automatic/authorizations"
      );
      body = init?.body ? JSON.parse(String(init.body)) : null;
      return jsonResponse({ id: "aut_yearly_1" });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await client.post("/pix/automatic/authorizations", {
      frequency: "YEARLY",
      paymentCreationMode: "MANUAL",
    });

    expect(calls).toBe(1);
    expect(body).toEqual({
      frequency: "ANNUALLY",
      paymentCreationMode: "MANUAL",
    });
  });

  it("preserves YEARLY for hosted checkout subscription cycles", async () => {
    let body: Record<string, unknown> | null = null;
    let calls = 0;
    const fetchImpl: typeof fetch = async (_request, init) => {
      calls += 1;
      body = init?.body ? JSON.parse(String(init.body)) : null;
      return jsonResponse({
        id: "chk_1",
        link: "https://asaas.com/checkoutSession/show?id=chk_1",
      });
    };
    const client = createAsaasClient({
      environment: "sandbox",
      apiKey: "key",
      fetchImpl,
    });

    await client.post("/checkouts", {
      subscription: { cycle: "YEARLY" },
    });

    expect(calls).toBe(1);
    expect(body).toEqual({
      subscription: { cycle: "YEARLY" },
    });
  });
});
