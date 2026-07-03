import type { Request, Response } from "express";
import { ZodError } from "zod";
import { BillingError, processBillingWebhook } from "./billingService";
import { billingWebhookSchema } from "./schemas";

function readSignatureHeader(req: Request) {
  const header = req.header("x-billing-signature") ?? req.header("x-mercadopago-signature") ?? req.header("x-asaas-signature");
  return header || undefined;
}

export async function handleBillingWebhook(req: Request, res: Response) {
  const verificationPayload = JSON.stringify(req.body ?? {});

  try {
    const input = billingWebhookSchema.parse({
      ...(req.body ?? {}),
      provider: req.params.provider ?? req.body?.provider ?? "sandbox",
      signature: readSignatureHeader(req),
      verificationPayload,
      payload: req.body ?? {},
    });

    const result = await processBillingWebhook(input);
    res.status(200).json({ ok: true, processed: result.processed, duplicate: result.duplicate });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ ok: false, error: "invalid_payload" });
      return;
    }

    if (error instanceof BillingError && error.code === "INVALID_WEBHOOK_SIGNATURE") {
      console.warn("[Billing] Webhook rejected: invalid signature");
      res.status(401).json({ ok: false, error: "invalid_signature" });
      return;
    }

    if (error instanceof BillingError && error.code === "WEBHOOK_SUBSCRIPTION_NOT_FOUND") {
      console.warn("[Billing] Webhook rejected: subscription not found");
      res.status(404).json({ ok: false, error: "subscription_not_found" });
      return;
    }

    console.warn("[Billing] Webhook processing failed:", error);
    res.status(500).json({ ok: false, error: "webhook_processing_failed" });
  }
}
