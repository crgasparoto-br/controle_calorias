import { beforeEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { verifyWhatsAppWebhook } from "./whatsappWebhook";
import { requireWhatsAppSendConfig } from "./whatsappConfig";

type MockResponse = {
  statusCode?: number;
  body?: unknown;
  status: (code: number) => MockResponse;
  send: (payload: unknown) => MockResponse;
};

function createMockResponse(): MockResponse {
  return {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("whatsapp webhook secrets", () => {
  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "consumo-calorias-verify-2026";
  });

  it("accepts the configured verify token and returns the challenge", () => {
    const req = {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": process.env.WHATSAPP_VERIFY_TOKEN,
        "hub.challenge": "meta-challenge-123",
      },
    } as Request;
    const res = createMockResponse() as unknown as Response;

    verifyWhatsAppWebhook(req, res);

    expect((res as unknown as MockResponse).statusCode).toBe(200);
    expect((res as unknown as MockResponse).body).toBe("meta-challenge-123");
  });

  it("validates the configured WhatsApp access token with a lightweight Graph API call", async () => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      await expect(requireWhatsAppSendConfig()).rejects.toThrow("WHATSAPP_ACCESS_TOKEN");
      return;
    }

    const response = await fetch("https://graph.facebook.com/v23.0/me?fields=id,name", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const payload = await response.json() as { id?: string; name?: string; error?: { message?: string; type?: string; code?: number } };

    expect(response.ok, JSON.stringify(payload)).toBe(true);
    expect(payload.error).toBeUndefined();
    expect(payload.id).toBeTruthy();
  }, 15000);
});
