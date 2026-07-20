import { protectedProcedure, router } from "../../_core/trpc";
import {
  professionalAiGenerateSchema,
  professionalAiPrioritySchema,
} from "./aiSchemas";
import { professionalAiService } from "./aiService";

export const professionalAiRouter = router({
  priorities: protectedProcedure
    .input(professionalAiPrioritySchema)
    .query(({ ctx, input }) =>
      professionalAiService.priorities(ctx.user.id, input.limit)
    ),
  generate: protectedProcedure
    .input(professionalAiGenerateSchema)
    .mutation(({ ctx, input }) =>
      professionalAiService.generate(ctx.user.id, input)
    ),
});
