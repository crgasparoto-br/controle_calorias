import type { Request, Response } from "express";
import { healthIntegrationService } from "./modules/healthIntegrations/stravaDetailSafeService";

function getFrontendRedirectBaseUrl() {
  const configured = process.env.STRAVA_APP_REDIRECT_BASE_URL
    ?? process.env.APP_URL
    ?? process.env.FRONTEND_URL
    ?? process.env.PUBLIC_APP_URL;
  return configured?.trim().replace(/\/$/, "") || null;
}

function buildRedirectUrl(pathAndQuery: string, message: string) {
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  const relativeRedirect = `${pathAndQuery}${separator}message=${encodeURIComponent(message)}`;
  const frontendBaseUrl = getFrontendRedirectBaseUrl();
  if (!frontendBaseUrl) return relativeRedirect;

  return `${frontendBaseUrl}${relativeRedirect.startsWith("/") ? relativeRedirect : `/${relativeRedirect}`}`;
}

export async function handleStravaOAuthCallback(req: Request, res: Response) {
  const result = await healthIntegrationService.handleStravaCallback({
    code: typeof req.query.code === "string" ? req.query.code : undefined,
    state: typeof req.query.state === "string" ? req.query.state : undefined,
    error: typeof req.query.error === "string" ? req.query.error : undefined,
    scope: typeof req.query.scope === "string" ? req.query.scope : undefined,
  });

  res.redirect(buildRedirectUrl(result.redirectTo, result.message));
}