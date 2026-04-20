import { beforeEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { verifyWhatsAppWebhook } from "./whatsappWebhook";

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

describe("whatsapp webhook verify token from env", () => {
  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = "consumo-calorias-verify-2026";
  });

  it("accepts the configured verify token and returns the challenge", () => {
    const req = {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "consumo-calorias-verify-2026",
        "hub.challenge": "meta-challenge-123",
      },
    } as Request;
    const res = createMockResponse() as unknown as Response;

    verifyWhatsAppWebhook(req, res);

    expect((res as unknown as MockResponse).statusCode).toBe(200);
    expect((res as unknown as MockResponse).body).toBe("meta-challenge-123");
  });
});
