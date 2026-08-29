import {
  reconcileBillingCommercialTransition,
  runBillingCommercialTransitionBatch,
  runBillingCommercialTransitionFinalizeBatch,
  runBillingCommercialTransitionNotificationBatch,
} from "../server/modules/billing/billingCommercialTransition";
import { obsoleteSupersededCommercialTransitionDeliveryAttempts } from "../server/modules/billing/billingCommercialTransitionSupersession";
import {
  billingCommercialTransitionMaintenanceSchema,
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

function maintenanceInput() {
  const execute = has("execute");
  const actorUserId = positiveInt("actor-user-id", 0);
  if (execute && actorUserId <= 0) {
    throw new Error("--actor-user-id is required for --execute");
  }
  const parsed = billingCommercialTransitionMaintenanceSchema.parse({
    cutoverKey: required("cutover-key"),
    dryRun: !execute,
    batchSize: positiveInt("batch-size", 100),
    retryFailed: has("retry-failed"),
    confirmation: flag("confirm"),
  });
  return { ...parsed, actorUserId };
}

async function withSupersession<T extends { dryRun: boolean; cutoverKey: string }>(
  input: T,
  run: () => Promise<Record<string, unknown>>
) {
  const result = await run();
  if (input.dryRun) return { ...result, supersession: { obsoleteAttempts: 0 } };
  const supersession = await obsoleteSupersededCommercialTransitionDeliveryAttempts(
    input.cutoverKey
  );
  return { ...result, supersession };
}

async function main() {
  if (has("reconcile")) {
    const input = billingCommercialTransitionReconcileSchema.parse({
      cutoverKey: required("cutover-key"),
    });
    console.log(JSON.stringify(await reconcileBillingCommercialTransition(input), null, 2));
    return;
  }

  if (has("notify")) {
    const input = maintenanceInput();
    console.log(JSON.stringify(
      await withSupersession(input, () =>
        runBillingCommercialTransitionNotificationBatch(input)
      ),
      null,
      2
    ));
    return;
  }

  if (has("finalize")) {
    const input = maintenanceInput();
    console.log(JSON.stringify(
      await withSupersession(input, () =>
        runBillingCommercialTransitionFinalizeBatch(input)
      ),
      null,
      2
    ));
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
  const input = { ...parsed, actorUserId };
  console.log(JSON.stringify(
    await withSupersession(input, () => runBillingCommercialTransitionBatch(input)),
    null,
    2
  ));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[billing-commercial-transition] ${message}`);
  process.exitCode = 1;
});
