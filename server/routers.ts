import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import type { TrpcContext } from "./_core/context";
import { authenticateLocalUser, registerLocalUser } from "./_core/localAuth";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { webWhatsappGreetingSchema } from "./modules/onboarding/schemas";
import { sendWebOnboardingWhatsappGreeting } from "./modules/onboarding/webGreetingService";
import {
  completeWhatsappOnboarding,
  getWhatsappOnboardingLeadByToken,
} from "./modules/onboarding/whatsappLeadService";
import {
  whatsappOnboardingCompleteSchema,
  whatsappOnboardingTokenSchema,
} from "./modules/onboarding/whatsappLeadSchemas";
import { getProfessionalProfile } from "./modules/professionals/service";
import { quickEditRouter } from "./modules/quickEdit/router";
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

async function sessionUser<T extends Record<string, unknown> & { id: number }>(user: T) {
  const professionalProfile = await getProfessionalProfile(user.id);
  return {
    ...sanitizeUser(user),
    professionalProfileActive: Boolean(professionalProfile?.active),
  };
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
    me: publicProcedure.query(async opts => opts.ctx.user ? sessionUser(opts.ctx.user) : null),
    register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
      try {
        const user = await registerLocalUser(input);
        await setSessionCookie(ctx, user);
        return await sessionUser(user);
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
        return await sessionUser(user);
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
    sendWhatsappGreeting: protectedProcedure.input(webWhatsappGreetingSchema).mutation(async ({ input, ctx }) => {
      try {
        return await sendWebOnboardingWhatsappGreeting(ctx.user.id, {
          acceptedOperationalWhatsapp: input.acceptedOperationalWhatsapp,
          userName: ctx.user.name,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "WHATSAPP_GREETING_CONSENT_REQUIRED") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Autorize o contato operacional pelo WhatsApp para receber a saudação." });
        }

        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível enviar a saudação pelo WhatsApp." });
      }
    }),
    whatsappOnboarding: router({
      validate: publicProcedure.input(whatsappOnboardingTokenSchema).query(async ({ input }) => {
        const lead = await getWhatsappOnboardingLeadByToken(input.token);
        if (!lead) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Link inválido, expirado ou já utilizado. Solicite um novo link pelo WhatsApp.",
          });
        }
        return lead;
      }),
      complete: publicProcedure.input(whatsappOnboardingCompleteSchema).mutation(async ({ input, ctx }) => {
        try {
          const user = await completeWhatsappOnboarding(input);
          await setSessionCookie(ctx, user);
          return await sessionUser(user);
        } catch (error) {
          if (error instanceof Error && error.message === "EMAIL_ALREADY_REGISTERED") {
            throw new TRPCError({ code: "CONFLICT", message: "Já existe uma conta com este e-mail. Entre na sua conta para vincular o WhatsApp." });
          }
          if (error instanceof Error && error.message === "INVALID_OR_EXPIRED_ONBOARDING_TOKEN") {
            throw new TRPCError({ code: "NOT_FOUND", message: "Link inválido, expirado ou já utilizado. Solicite um novo link pelo WhatsApp." });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível concluir o cadastro iniciado pelo WhatsApp." });
        }
      }),
    }),
  }),
  nutrition: nutritionRouter,
  quickEdit: quickEditRouter,
});

export type AppRouter = typeof appRouter;
