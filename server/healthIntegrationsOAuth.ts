import type { Request, Response } from "express";
import { healthIntegrationService } from "./modules/healthIntegrations/service";

export async function handleStravaOAuthCallback(req: Request, res: Response) {
  const result = await healthIntegrationService.handleStravaCallback({
    code: typeof req.query.code === "string" ? req.query.code : undefined,
    state: typeof req.query.state === "string" ? req.query.state : undefined,
    error: typeof req.query.error === "string" ? req.query.error : undefined,
    scope: typeof req.query.scope === "string" ? req.query.scope : undefined,
  });

  const message = encodeURIComponent(result.message);
  res.redirect(`${result.redirectTo}&message=${message}`);
}
