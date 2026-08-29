import {
  reconcileBillingCommercialTransition,
  runBillingCommercialTransitionBatch,
} from "../server/modules/billing/billingCommercialTransition";
import {
  billingCommercialTransitionReconcileSchema,
  billingCommercialTransitionRunSchema,
} from "../server/modules/billing/billingCommercialTransitionSchemas";

function flag(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string) {
  return process.argv.includes(`--${name}`);
}

function required(name: string) {
  const value = flag(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function positiveInt(name: string, fallback: number) {
  const raw = flag(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid --${name}`);
  }
  return value;
}

async function main() {
  if (has("reconcile")) {
    const input = billingCommercialTransitionReconcileSchema.parse({
      cutoverKey: required("cutover-key"),
    });
    console.log(JSON.stringify(await reconcileBillingCommercialTransition(input), null, 2));
    return;
  }

  const execute = has("execute");
  const actorUserId = positiveInt("actor-user-id", 0);
  if (execute && actorUserId <= 0) {
    throw new Error("--actor-user-id is required for --execute");
  }

  const parsed = billingCommercialTransitionRunSchema.parse({
    cutoverKey: required("cutover-key"),
    cutoverAt: required("cutover-at"),
    timezone: required("timezone"),
    reason: required("reason"),
    dryRun: !execute,
    batchSize: positiveInt("batch-size", 100),
    retryFailed: has("retry-failed"),
    confirmation: flag("confirm"),
  });

  const result = await runBillingCommercialTransitionBatch({
    ...parsed,
    actorUserId,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[billing-commercial-transition] ${message}`);
  process.exitCode = 1;
});
