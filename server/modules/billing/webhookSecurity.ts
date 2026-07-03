import { createHmac, timingSafeEqual } from "crypto";

export function createBillingWebhookSignature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verifyBillingWebhookSignature(payload: string, signature: string | undefined, secret: string | undefined) {
  if (!secret) return true;
  if (!signature) return false;

  const expected = createBillingWebhookSignature(payload, secret);
  const received = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
