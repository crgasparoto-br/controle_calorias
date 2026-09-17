import { describe, expect, it, vi } from "vitest";

const fallback = vi.hoisted(() => vi.fn());

vi.mock("./whatsappWebhook", () => ({
  handleWhatsAppWebhook: fallback,
}));

const {
  handleWhatsAppWebhookWithAnnotatedImages: handleAnnotatedImplementation,
} = await import("./whatsappAnnotatedImageWebhookImplementation");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("Issue #1096 — reachability runtime do fallback de anotação", () => {
  it("a implementação de anotação mantém o fallback final quando não há mensagens", async () => {
    const response = createResponse();
    fallback.mockImplementation(async (_req, res) =>
      res.status(200).json({ ok: true, fallback: true })
    );

    await handleAnnotatedImplementation(
      { body: {} } as never,
      response as never
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, fallback: true });
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
