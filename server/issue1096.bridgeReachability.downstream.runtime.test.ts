import { describe, expect, it, vi } from "vitest";

const annotatedImplementation = vi.hoisted(() => vi.fn());

vi.mock("./whatsappAnnotatedImageWebhookImplementation", () => ({
  handleWhatsAppWebhookWithAnnotatedImages: annotatedImplementation,
}));

vi.mock("./whatsappWebhook", () => ({
  handleWhatsAppWebhook: vi.fn(),
}));

const { handleWhatsAppWebhookWithTextIntent } = await import(
  "./whatsappIntentWebhook"
);

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

function createImageRequest() {
  return {
    body: {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "phone-number-test" },
                messages: [
                  {
                    id: "wamid-1096-runtime-image",
                    from: "5511999999999",
                    timestamp: "1789556400",
                    type: "image",
                    image: { id: "media-1096-runtime", mime_type: "image/jpeg" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

describe("Issue #1096 — reachability runtime do wrapper de intenção", () => {
  it("intenção alcança a fachada de anotação e sua implementação para imagens", async () => {
    const response = createResponse();
    annotatedImplementation.mockImplementation(async (_req, res) =>
      res.status(200).json({ ok: true, processed: 1 })
    );

    await handleWhatsAppWebhookWithTextIntent(
      createImageRequest() as never,
      response as never
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, processed: 1 });
    expect(annotatedImplementation).toHaveBeenCalledTimes(1);
  });
});
