import "dotenv/config";
import express, { type RequestHandler } from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV, validateRuntimeEnv } from "./env";
import { PAYLOAD_LIMITS, RATE_LIMITS, createExpressRateLimit } from "./rateLimit";
import { serveStatic, setupVite } from "./vite";
import { handleStravaOAuthCallback } from "../healthIntegrationsOAuth";
import { handleMediaRequest } from "../mediaProxy";
import { startStravaAutoSyncScheduler } from "../modules/healthIntegrations/stravaScheduler";
import { handleWhatsAppWebhookWithImageIdempotency } from "../whatsappImageIdempotencyWebhook";
import { verifyWhatsAppWebhook } from "../whatsappWebhook";
import { syncFoodCatalogReference } from "../foodCatalogSync";
import { RuntimeSchemaCompatibilityError, ensureRuntimeSchemaCompatibility } from "../schemaCompatibility";

const MEDIA_TRPC_PATHS = [
  "/api/trpc/nutrition.foodPhotoAnalysis.analyze",
  "/api/trpc/nutrition.meals.processDraft",
];

function isMediaTrpcRequest(originalUrl: string) {
  const pathname = originalUrl.split("?")[0] ?? "";
  return MEDIA_TRPC_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
}

function skipForMediaTrpcRequests(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (isMediaTrpcRequest(req.originalUrl)) {
      next();
      return;
    }

    parser(req, res, next);
  };
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  validateRuntimeEnv();

  const app = express();
  const server = createServer(app);
  try {
    const schemaCompatibility = await ensureRuntimeSchemaCompatibility();
    if (schemaCompatibility.added.length || schemaCompatibility.updated.length) {
      console.log("[Database] Runtime schema compatibility applied:", schemaCompatibility);
    }
  } catch (error) {
    if (error instanceof RuntimeSchemaCompatibilityError) {
      console.error("[Database] Runtime schema compatibility failed:", error.message);
      throw error;
    }

    if (ENV.isProduction) {
      console.error("[Database] Production database validation failed:", error);
      throw error;
    }

    console.warn("[Database] Runtime schema compatibility skipped:", error);
  }

  try {
    const catalogSync = await syncFoodCatalogReference();
    console.log("[Nutrition] Food catalog sync:", catalogSync);
  } catch (error) {
    console.warn("[Nutrition] Food catalog sync skipped:", error);
  }
  startStravaAutoSyncScheduler();

  const defaultJsonParser = express.json({ limit: PAYLOAD_LIMITS.defaultJson });
  const defaultUrlencodedParser = express.urlencoded({ limit: PAYLOAD_LIMITS.defaultJson, extended: true });
  const mediaJsonParser = express.json({ limit: PAYLOAD_LIMITS.mediaJson });
  const webhookRateLimit = createExpressRateLimit(RATE_LIMITS.whatsappWebhook);

  app.use(MEDIA_TRPC_PATHS, mediaJsonParser);
  app.use("/api/trpc", skipForMediaTrpcRequests(defaultJsonParser));
  app.use("/api/trpc", skipForMediaTrpcRequests(defaultUrlencodedParser));

  app.get("/api/media", (req, res) => {
    void handleMediaRequest(req, res);
  });
  app.get("/api/health-integrations/strava/callback", (req, res) => {
    void handleStravaOAuthCallback(req, res);
  });
  app.get("/api/whatsapp/webhook", webhookRateLimit, verifyWhatsAppWebhook);
  app.post(
    "/api/whatsapp/webhook",
    webhookRateLimit,
    express.json({ limit: PAYLOAD_LIMITS.webhookJson }),
    express.urlencoded({ limit: PAYLOAD_LIMITS.webhookJson, extended: true }),
    (req, res) => {
      void handleWhatsAppWebhookWithImageIdempotency(req, res);
    }
  );
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
