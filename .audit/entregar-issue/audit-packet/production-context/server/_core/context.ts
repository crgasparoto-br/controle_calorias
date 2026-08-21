import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  const shouldUseDevBypass =
    !user &&
    !ENV.isProduction &&
    process.env.DEV_AUTH_BYPASS === "true";

  if (shouldUseDevBypass) {
    const openId = process.env.DEV_AUTH_OPEN_ID ?? "local-dev-user";
    const name = process.env.DEV_AUTH_NAME ?? "Local Dev";
    const role = process.env.DEV_AUTH_ROLE === "user" ? "user" : "admin";

    try {
      await db.upsertUser({
        openId,
        name,
        role,
        lastSignedIn: new Date(),
      });

      user =
        (await db.getUserByOpenId(openId)) ?? {
          id: -1,
          openId,
          name,
          email: null,
          loginMethod: "dev-bypass",
          role,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        };
    } catch {
      user = {
        id: -1,
        openId,
        name,
        email: null,
        loginMethod: "dev-bypass",
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      };
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
