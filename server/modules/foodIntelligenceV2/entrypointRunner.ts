/** #1308: a single D1 route for all authorized modalities (inactive until Gate A). */
import { buildD1OperationPlan, type FoodD1Result, type FoodD1Dependencies,
  type FoodD1Request } from "./entrypointMigration";
import { routeFoodD1Operation, isFoodD1CutoverRequested, isCurrentFoodD1GateApproval,
  type FoodD1GateApproval } from "./entrypointRouting";
import { createFoodD1RouteDbStore } from "./entrypointRouteRepository";
import { readOnlyFoodKnowledge } from "./shadowRunner";
import { prepareFoodD1NativeWrite } from "./entrypointPersistence";
import { commitFoodD1NativeWrite, type FoodD1CommitResult } from "./entrypointPersistenceRepository";

/**
 * The channel supplies only an authenticated, canonical envelope, authorized
 * evidence, and its existing V1 callback. Source approval is a server function,
 * never a value from the incoming user message or the environment alone.
 *
 * No production provider is registered before post-deploy Gate A (#1335).
 */
export async function runFoodD1Migration<T>(input: {
  request: FoodD1Request;
  source: "web" | "whatsapp";
  occurredAt: Date;
  dependencies: FoodD1Dependencies;
  legacy: () => Promise<T>;
  verifyGates: () => Promise<FoodD1GateApproval | null>;
  /** SHA of the trusted running build, not from an inbound request. */
  expectedAuditedBaseSha: string;
}): Promise<T | FoodD1CommitResult | FoodD1Result> {
  // The public simulator shares the resolver but is read-only: no route
  // binding, meal mutation or database dependency in replay.
  if (input.request.entrypoint === "simulator") {
    if (!isFoodD1CutoverRequested()) return input.legacy();
    let approval: FoodD1GateApproval | null = null;
    try { approval = await input.verifyGates(); }
    catch { /* Approval unavailable: fail closed. */ }
    if (!isCurrentFoodD1GateApproval(approval, input.expectedAuditedBaseSha)) {
      throw new Error("food-d1-independent-gates-not-approved");
    }
    return buildD1OperationPlan(input.request, {
      ...input.dependencies,
      knowledge: readOnlyFoodKnowledge(input.dependencies.knowledge),
    });
  }
  const store = createFoodD1RouteDbStore();
  return routeFoodD1Operation<T | FoodD1CommitResult>({
    envelope: input.request.envelope,
    authenticatedUserId: input.request.authenticatedUserId,
    entrypoint: input.request.entrypoint,
    source: input.source,
    store,
    expectedAuditedBaseSha: input.expectedAuditedBaseSha,
    verifyGates: input.verifyGates,
    runV1: input.legacy,
    runV2: async () => {
      const result = await buildD1OperationPlan(input.request, input.dependencies);
      const plan = prepareFoodD1NativeWrite({
        envelope: input.request.envelope, result,
        authenticatedUserId: input.request.authenticatedUserId,
        source: input.source, occurredAt: input.occurredAt,
      });
      return commitFoodD1NativeWrite({
        plan,
        verifyCurrentGate: async () => {
          const current = await input.verifyGates();
          return isCurrentFoodD1GateApproval(current, input.expectedAuditedBaseSha);
        },
      });
    },
  });
}
