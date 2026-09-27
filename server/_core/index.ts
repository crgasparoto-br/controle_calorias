import "dotenv/config";
import express, { type RequestHandler } from "express";
import { createServer } from "http";
import net from "net";
import { randomUUID } from "node:crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV, validateRuntimeEnv } from "./env";
import {
  PAYLOAD_LIMITS,
  RATE_LIMITS,
  createExpressRateLimit,
} from "./rateLimit";
import { serveStatic, setupVite } from "./vite";
import { exposeHttpAvailabilityBeforeBackgroundTasks } from "./runtimeAvailability";
import { installRuntimeTerminationDiagnostics } from "./runtimeTerminationDiagnostics";
import { installRuntimeResourceDiagnostics } from "./runtimeResourceDiagnostics";
import {
  RUNTIME_STARTUP_DELAYS_MS,
  scheduleRuntimeStartupSteps,
} from "./runtimeStartupScheduling";
import { handleStravaOAuthCallback } from "../healthIntegrationsOAuth";
import { handleMediaRequest } from "../mediaProxy";
import {
  handleStravaWebhookVerification,
  handleStravaWebhookEvent,
} from "../modules/healthIntegrations/stravaWebhookHandler";
import { startWhatsappQuestionRecoveryScheduler } from "../modules/whatsapp/questionRecovery";
import { handleWhatsAppPersistentContextWebhook } from "../whatsappPersistentContextWebhook";
import { registerWhatsAppPublicPostRoute } from "../whatsappPublicRoute";
import { verifyWhatsAppWebhook } from "../whatsappWebhook";
import { syncFoodCatalogReference } from "../foodCatalogSync";
import { safeLogDetail } from "../privacy";
import {
  RuntimeSchemaCompatibilityError,
  ensureRuntimeSchemaCompatibility,
} from "../schemaCompatibility";
import {
  ProfessionalRuntimeSchemaCompatibilityError,
  ensureProfessionalRuntimeSchemaCompatibility,
} from "../modules/professionals/runtimeSchemaCompatibility";
import { startConversationRetentionScheduler } from "../modules/whatsapp/conversationRetentionScheduler";
import { handleProfessionalAccessRevocationStream } from "../modules/professionals/accessRevocationStream";
import { configureAiObservabilityLogging } from "../modules/aiObservability/logSink";
import {
  configureUsageGovernanceRuntime,
  startUsageGovernanceRetentionScheduler,
} from "../modules/usageGovernance/runtime";
import {
  configureAsaasBillingRuntime,
  getAsaasWebhookHandler,
  startAsaasBillingReconciliationScheduler,
} from "../modules/billing/asaas/runtime";
import { configureAsaasBillingLifecycleHooks } from "../modules/billing/asaas/remediationRuntime";
import { startAsaasPixAuthorizationRecoveryScheduler } from "../modules/billing/asaas/pixAuthorizationRecovery";

const MEDIA_TRPC_PATHS = [
  "/api/trpc/nutrition.foodPhotoAnalysis.analyze",
  "/api/trpc/nutrition.meals.processDraft",
];

function isMediaTrpcRequest(originalUrl: string) {
  const pathname = originalUrl.split("?")[0] ?? "";
  return MEDIA_TRPC_PATHS.some(
    path => pathname === path || pathname.startsWith(`${path}/`)
  );
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

function listenHttpServer(
  server: ReturnType<typeof createServer>,
  port: number
) {
  return new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port);
  });
}

async function startServer() {
  const runtimeBootId = randomUUID();
  const runtimeBootStartedAt = Date.now();
  const runtimeCommit =
    process.env.RENDER_GIT_COMMIT?.match(/^[0-9a-f]{40}$/iu)?.[0] ?? null;
  console.info("[Runtime] boot_started", {
    bootId: runtimeBootId,
    pid: process.pid,
    commit: runtimeCommit,
  });
  installRuntimeTerminationDiagnostics({
    bootId: runtimeBootId,
    bootStartedAt: runtimeBootStartedAt,
    commit: runtimeCommit,
  });
  const runtimeResources = installRuntimeResourceDiagnostics({
    bootId: runtimeBootId,
    bootStartedAt: runtimeBootStartedAt,
    commit: runtimeCommit,
  });

  validateRuntimeEnv();
  configureAiObservabilityLogging();
  configureUsageGovernanceRuntime();
  configureAsaasBillingRuntime();
  configureAsaasBillingLifecycleHooks();

  const app = express();
  const server = createServer(app);

  // Deliberately independent of database, providers and background schedulers.
  // Render can use this endpoint as a cheap liveness/readiness probe without
  // making WhatsApp recovery depend on a health-check side effect.
  app.get("/healthz", (_req, res) => {
    res.status(200).type("text/plain").send("ok");
  });
  try {
    const schemaCompatibility = await ensureRuntimeSchemaCompatibility();
    if (
      schemaCompatibility.added.length ||
      schemaCompatibility.updated.length
    ) {
      console.log(
        "[Database] Runtime schema compatibility applied:",
        schemaCompatibility
      );
    }

    const professionalSchemaCompatibility =
      await ensureProfessionalRuntimeSchemaCompatibility();
    if (professionalSchemaCompatibility.added.length) {
      console.log(
        "[Database] Professional runtime schema compatibility applied:",
        professionalSchemaCompatibility
      );
    }
  } catch (error) {
    if (
      error instanceof RuntimeSchemaCompatibilityError ||
      error instanceof ProfessionalRuntimeSchemaCompatibilityError
    ) {
      console.error(
        "[Database] Runtime schema compatibility failed:",
        error.message
      );
      throw error;
    }

    if (ENV.isProduction) {
      console.error("[Database] Production database validation failed:", error);
      throw error;
    }

    console.warn("[Database] Runtime schema compatibility skipped:", error);
  }

  const defaultJsonParser = express.json({ limit: PAYLOAD_LIMITS.defaultJson });
  const defaultUrlencodedParser = express.urlencoded({
    limit: PAYLOAD_LIMITS.defaultJson,
    extended: true,
  });
  const mediaJsonParser = express.json({ limit: PAYLOAD_LIMITS.mediaJson });
  const webhookRateLimit = createExpressRateLimit(RATE_LIMITS.whatsappWebhook);
  const asaasWebhookHandler = getAsaasWebhookHandler();

  app.use(MEDIA_TRPC_PATHS, mediaJsonParser);
  app.use("/api/trpc", skipForMediaTrpcRequests(defaultJsonParser));
  app.use("/api/trpc", skipForMediaTrpcRequests(defaultUrlencodedParser));

  app.get("/api/professional/access-events", (req, res) => {
    void handleProfessionalAccessRevocationStream(req, res);
  });
  app.get("/api/media", (req, res) => {
    void handleMediaRequest(req, res);
  });
  app.get("/api/health-integrations/strava/callback", (req, res) => {
    void handleStravaOAuthCallback(req, res);
  });
  app.get("/api/health-integrations/strava/webhook", (req, res) => {
    handleStravaWebhookVerification(req, res);
  });
  app.post(
    "/api/health-integrations/strava/webhook",
    express.json({ limit: "4kb" }),
    (req, res) => {
      handleStravaWebhookEvent(req, res);
    }
  );
  app.get("/api/whatsapp/webhook", webhookRateLimit, verifyWhatsAppWebhook);
  registerWhatsAppPublicPostRoute(app, {
    webhookRateLimit,
    runtimeBootId,
    runtimeCommit,
    handle: handleWhatsAppPersistentContextWebhook,
  });
  app.post(
    "/api/billing/asaas/webhook",
    express.raw({ type: "application/json", limit: "128kb" }),
    (req, res) => {
      void asaasWebhookHandler(req, res);
    }
  );
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
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

  await exposeHttpAvailabilityBeforeBackgroundTasks({
    listen: () => listenHttpServer(server, port),
    onReady: () => {
      console.log(`Server running on http://localhost:${port}/`);
      console.info("[Runtime] http_ready", {
        bootId: runtimeBootId,
        port,
        startupMs: Date.now() - runtimeBootStartedAt,
      });
      runtimeResources.checkpoint("http_ready");
    },
    tasks: [],
  });

  // Recovery de mensagem persistida é a primeira responsabilidade pós-HTTP.
  // Os jobs de manutenção abaixo são escalonados para não competir todos no
  // mesmo instante de boot em instâncias com orçamento de memória pequeno.
  startWhatsappQuestionRecoveryScheduler();
  startConversationRetentionScheduler();

  scheduleRuntimeStartupSteps({
    steps: [
      {
        name: "food-catalog-sync",
        delayMs: RUNTIME_STARTUP_DELAYS_MS.foodCatalogSync,
        start: async () => {
          runtimeResources.checkpoint("food-catalog-sync:before");
          const catalogSync = await syncFoodCatalogReference();
          console.log("[Nutrition] Food catalog sync:", catalogSync);
          runtimeResources.checkpoint("food-catalog-sync:after");
        },
      },
      {
        name: "usage-governance",
        delayMs: RUNTIME_STARTUP_DELAYS_MS.usageGovernance,
        start: () => {
          runtimeResources.checkpoint("usage-governance:start");
          return startUsageGovernanceRetentionScheduler();
        },
      },
      {
        name: "asaas-reconciliation",
        delayMs: RUNTIME_STARTUP_DELAYS_MS.asaasBilling,
        start: () => {
          runtimeResources.checkpoint("asaas-reconciliation:start");
          return startAsaasBillingReconciliationScheduler();
        },
      },
      {
        name: "asaas-pix-authorization-recovery",
        delayMs: RUNTIME_STARTUP_DELAYS_MS.asaasPixAuthorization,
        start: () => {
          runtimeResources.checkpoint("asaas-pix-authorization-recovery:start");
          return startAsaasPixAuthorizationRecoveryScheduler();
        },
      },
    ],
  });
}

startServer().catch(error => {
  console.error("[Runtime] startup_failed", safeLogDetail(error));
});
