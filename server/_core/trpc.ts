import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { enforceProtectedProcedurePolicies } from "./procedurePolicy";
import { enforceProtectedProcedureResultPolicies } from "./procedureResultPolicy";
import { runWithAiUsageScope } from "./ai/usageContext";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next, path, type, getRawInput } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  const authenticatedCtx = {
    ...ctx,
    user: ctx.user,
  };
  await enforceProtectedProcedurePolicies({ path, type, ctx: authenticatedCtx });

  return runWithAiUsageScope({ userId: ctx.user.id }, async () => {
    const rawInput = await getRawInput();
    const result = await next({ ctx: authenticatedCtx });
    return enforceProtectedProcedureResultPolicies({
      path,
      result,
      ctx: authenticatedCtx,
      input: rawInput,
    });
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    const authenticatedCtx = { ...ctx, user: ctx.user };
    return runWithAiUsageScope({ userId: authenticatedCtx.user.id }, () => next({
      ctx: authenticatedCtx,
    }));
  }),
);
