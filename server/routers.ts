import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import type { TrpcContext } from "./_core/context";
import { authenticateLocalUser, registerLocalUser } from "./_core/localAuth";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { nutritionRouter } from "./nutritionRouter";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
});

const loginSchema = registerSchema.pick({ email: true, password: true });

function sanitizeUser<T extends Record<string, unknown>>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safeUser } = user as T & { passwordHash?: unknown };
  return safeUser as Omit<T, "passwordHash">;
}

async function setSessionCookie(
  ctx: TrpcContext,
  user: { id: number; email: string | null; name: string | null; role: "user" | "admin" }
) {
  const email = user.email ?? "";
  const name = user.name ?? email;
  if (!email || !name) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível iniciar a sessão." });
  }

  const sessionToken = await sdk.signSession(
    {
      userId: user.id,
      email,
      name,
      role: user.role,
    },
    { expiresInMs: ONE_YEAR_MS }
  );
  const cookieOptions = getSessionCookieOptions(ctx.req);
  ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ? sanitizeUser(opts.ctx.user) : null),
    register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
      try {
        const user = await registerLocalUser(input);
        await setSessionCookie(ctx, user);
        return sanitizeUser(user);
      } catch (error) {
        if (error instanceof Error && error.message === "EMAIL_ALREADY_REGISTERED") {
          throw new TRPCError({ code: "CONFLICT", message: "Não foi possível criar a conta com estes dados." });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a conta." });
      }
    }),
    login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
      try {
        const user = await authenticateLocalUser(input);
        await setSessionCookie(ctx, user);
        return sanitizeUser(user);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha inválidos." });
        }

        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível iniciar a sessão." });
      }
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  nutrition: nutritionRouter,
});

export type AppRouter = typeof appRouter;
