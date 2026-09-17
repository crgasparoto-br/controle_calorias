import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { registerWhatsAppPublicPostRoute } from "./whatsappPublicRoute";

function listen(app: express.Express) {
  return new Promise<{ server: Server; url: string }>((resolve, reject) => {
    const server = createServer(app);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Servidor de teste não expôs uma porta."));
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

describe("Issue #1097 — correlação sanitizada do runtime publicado", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) await close(server);
    server = null;
  });

  it("expõe somente um prefixo hexadecimal do commit válido", async () => {
    const app = express();
    registerWhatsAppPublicPostRoute(app, {
      runtimeBootId: "issue-1097-runtime",
      runtimeCommit: "8851ad16deadbeef",
      webhookRateLimit: (_req, _res, next) => next(),
      handle: async (_req, res) =>
        res.status(200).json({ ok: true, processed: 0 }),
    });
    const listening = await listen(app);
    server = listening.server;

    const response = await fetch(`${listening.url}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entry: [] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-runtime-commit")).toBe("8851ad16deadbeef");
  });

  it("não fabrica correlação para valor inválido", async () => {
    const app = express();
    registerWhatsAppPublicPostRoute(app, {
      runtimeBootId: "issue-1097-runtime",
      runtimeCommit: "render-value-with-sensitive-data",
      webhookRateLimit: (_req, _res, next) => next(),
      handle: async (_req, res) =>
        res.status(200).json({ ok: true, processed: 0 }),
    });
    const listening = await listen(app);
    server = listening.server;

    const response = await fetch(`${listening.url}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entry: [] }),
    });

    expect(response.headers.get("x-runtime-commit")).toBe("unavailable");
  });
});
