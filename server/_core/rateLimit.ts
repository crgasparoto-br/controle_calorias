import type { Request, RequestHandler } from "express";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitOptions = {
  keyPrefix: string;
  windowMs: number;
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const buckets = new Map<string, RateLimitBucket>();
const RATE_LIMIT_MESSAGE = "Muitas tentativas. Aguarde um pouco antes de tentar novamente.";

export const RATE_LIMITS = {
  auth: {
    keyPrefix: "auth",
    windowMs: 15 * 60 * 1000,
    max: 20,
  },
  publicOnboarding: {
    keyPrefix: "public-onboarding",
    windowMs: 15 * 60 * 1000,
    max: 30,
  },
  quickEdit: {
    keyPrefix: "quick-edit",
    windowMs: 15 * 60 * 1000,
    max: 60,
  },
  whatsappWebhook: {
    keyPrefix: "whatsapp-webhook",
    windowMs: 60 * 1000,
    max: 120,
  },
} as const satisfies Record<string, RateLimitOptions>;

export const PAYLOAD_LIMITS = {
  defaultJson: "1mb",
  mediaJson: "50mb",
  webhookJson: "5mb",
} as const;

function getForwardedIp(req: Pick<Request, "headers">) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return value?.split(",")[0]?.trim() || "";
}

export function getRequestRateLimitIdentity(req: Request) {
  return getForwardedIp(req) || req.ip || req.socket?.remoteAddress || "unknown";
}

function cleanupExpiredBuckets(now: number) {
  if (buckets.size < 1000) return;

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function consumeRateLimit(key: string, options: RateLimitOptions, now = Date.now()): RateLimitResult {
  cleanupExpiredBuckets(now);

  const current = buckets.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + options.windowMs };

  if (bucket.count >= options.max) {
    buckets.set(key, bucket);
    return {
      allowed: false,
      limit: options.max,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    allowed: true,
    limit: options.max,
    remaining: Math.max(options.max - bucket.count, 0),
    resetAt: bucket.resetAt,
    retryAfterSeconds: 0,
  };
}

function setRateLimitHeaders(
  target: { setHeader(name: string, value: string): void },
  result: RateLimitResult
) {
  target.setHeader("X-RateLimit-Limit", String(result.limit));
  target.setHeader("X-RateLimit-Remaining", String(result.remaining));
  target.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) {
    target.setHeader("Retry-After", String(result.retryAfterSeconds));
  }
}

export function createExpressRateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const identity = getRequestRateLimitIdentity(req);
    const result = consumeRateLimit(`${options.keyPrefix}:${identity}`, options);
    setRateLimitHeaders(res, result);

    if (!result.allowed) {
      res.status(429).json({ error: RATE_LIMIT_MESSAGE });
      return;
    }

    next();
  };
}

export function enforceTrpcRateLimit(ctx: TrpcContext, options: RateLimitOptions, scope: string) {
  const identity = getRequestRateLimitIdentity(ctx.req);
  const result = consumeRateLimit(`${options.keyPrefix}:${scope}:${identity}`, options);
  setRateLimitHeaders(ctx.res, result);

  if (!result.allowed) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: RATE_LIMIT_MESSAGE });
  }
}

export function resetRateLimitStoreForTests() {
  buckets.clear();
}
