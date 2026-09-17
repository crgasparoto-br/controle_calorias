import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const downstream = vi.hoisted(() => vi.fn());
const gateSuspendedWhatsAppWritesMock = vi.hoisted(() => vi.fn());
const stages = vi.hoisted(() => [] as string[]);

vi.mock("./whatsappImageIdempotencyWebhook", () => ({
  handleWhatsAppWebhookWithImageIdempotency: downstream,
}));

vi.mock("./whatsappBillingWriteGate", () => ({
  gateSuspendedWhatsAppWrites: gateSuspendedWhatsAppWritesMock,
}));

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  enrichInboundMessage: vi.fn(async () => true),
  runWithMessageLifecycleRequestScope: async <T>(operation: () => Promise<T>) =>
    operation(),
}));

vi.mock("./modules/whatsapp/questionLatencyContext", () => ({
  runWithQuestionLatencyContext: <T>(operation: () => Promise<T>) => operation(),
}));

vi.mock("./modules/whatsapp/timeZoneContext", () => ({
  runWithWhatsAppTimeZoneRequestScope: <T>(operation: () => Promise<T>) =>
    operation(),
}));

vi.mock("./storagePersistenceCorrelation", () => ({
  withStoragePersistenceCorrelations: <T>(
    _correlations: unknown,
    operation: () => Promise<T>,
  ) => operation(),
}));

const { registerWhatsAppPublicPostRoute } = await import("./whatsappPublicRoute");

function createPayload() {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid-1096-runtime-route",
                  from: "5511999999999",
                  timestamp: "1789556400",
                  type: "text",
                  text: { body: "100 g de arroz branco" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function listen(app: express.Express) {
  return new Promise<{ server: Server; url: string }>((resolve, reject) => {
    const server = createServer(app);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Não foi possível obter a porta do servidor de teste."));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

describe("Issue #1096 — reachability runtime do entrypoint público", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) await close(server);
    server = null;
    stages.length = 0;
    downstream.mockReset();
    gateSuspendedWhatsAppWritesMock.mockReset();
  });

  it("alcança o wrapper de idempotência pelo POST público sem bypass", async () => {
    downstream.mockImplementation(async (_req, res) => {
      stages.push("image-idempotency");
      return res.status(200).json({ ok: true, processed: 1 });
    });
    gateSuspendedWhatsAppWritesMock.mockImplementation(async (payload: unknown) => ({
      handledCount: 0,
      remainingPayload: payload,
    }));

    const app = express();
    registerWhatsAppPublicPostRoute(app, {
      runtimeBootId: "issue-1096-runtime",
      webhookRateLimit: (_req, _res, next) => next(),
    });
    const listening = await listen(app);
    server = listening.server;

    const response = await fetch(`${listening.url}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createPayload()),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, processed: 1 });
    expect(stages).toEqual(["image-idempotency"]);
    expect(downstream).toHaveBeenCalledTimes(1);
    expect(gateSuspendedWhatsAppWritesMock).toHaveBeenCalledTimes(1);
  });
});
