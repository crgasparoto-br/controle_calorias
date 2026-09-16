import express, { type Express, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { PAYLOAD_LIMITS } from "./_core/rateLimit";
import { resolveWhatsAppWebhookCorrelation } from "./modules/whatsapp/webhookCorrelation";
import { safeLogDetail } from "./privacy";
import { handleWhatsAppPersistentContextWebhook } from "./whatsappPersistentContextWebhook";

export type WhatsAppPublicRouteOptions = {
  observeIngress?: RequestHandler;
  webhookRateLimit: RequestHandler;
  runtimeBootId: string;
  handle?: (
    req: express.Request,
    res: express.Response
  ) => Promise<unknown> | unknown;
};

export function createWhatsAppIngressObserver(
  runtimeBootId: string
): RequestHandler {
  return (req, res, next) => {
    const ingressId = randomUUID();
    res.locals.whatsappIngressId = ingressId;
    console.info("[WhatsAppWebhook] ingress_received", {
      bootId: runtimeBootId,
      ingressId,
      state: "request_reached_runtime",
      method: req.method,
      contentLength: req.get("content-length") ?? null,
    });
    next();
  };
}

export function registerWhatsAppPublicPostRoute(
  app: Express,
  options: WhatsAppPublicRouteOptions
) {
  const observeIngress =
    options.observeIngress ??
    createWhatsAppIngressObserver(options.runtimeBootId);
  const handle = options.handle ?? handleWhatsAppPersistentContextWebhook;

  app.post(
    "/api/whatsapp/webhook",
    observeIngress,
    options.webhookRateLimit,
    express.json({ limit: PAYLOAD_LIMITS.webhookJson }),
    express.urlencoded({
      limit: PAYLOAD_LIMITS.webhookJson,
      extended: true,
    }),
    (req, res) => {
      const correlation = resolveWhatsAppWebhookCorrelation(req.body);
      console.info("[WhatsAppWebhook] lifecycle_dispatch", {
        bootId: options.runtimeBootId,
        ingressId: res.locals.whatsappIngressId ?? null,
        state: "request_entering_lifecycle",
        ...correlation,
      });
      void Promise.resolve(handle(req, res)).catch(error => {
        console.error("[WhatsAppWebhook] Request failed", {
          bootId: options.runtimeBootId,
          ingressId: res.locals.whatsappIngressId ?? null,
          state: "lifecycle_failed_retryable",
          ...correlation,
          error: safeLogDetail(error),
        });
        if (!res.headersSent) {
          res.status(503).json({ ok: false, retry: true });
        }
      });
    }
  );
}
