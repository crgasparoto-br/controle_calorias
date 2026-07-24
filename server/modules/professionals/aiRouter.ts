import { router } from "../../_core/trpc";
import {
  professionalAiGenerateSchema,
  professionalAiPrioritySchema,
} from "./aiSchemas";
import { professionalAiProcedure } from "./entitledProcedure";
import { professionalAiService } from "./aiService";
import { professionalPriorityService } from "./aiPrioritiesService";

export const professionalAiRouter = router({
  priorities: professionalAiProcedure
    .input(professionalAiPrioritySchema)
    .query(({ ctx, input }) =>
      professionalPriorityService.priorities(ctx.user.id, input.limit)
    ),
  generate: professionalAiProcedure
    .input(professionalAiGenerateSchema)
    .mutation(({ ctx, input }) =>
      professionalAiService.generate(ctx.user.id, input)
    ),
});
