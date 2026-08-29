import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const unitSuites = [
  "server/auth.whatsappOnboarding.test.ts",
  "server/modules/onboarding/service.test.ts",
  "server/modules/onboarding/webGreetingService.test.ts",
  "server/modules/onboarding/whatsappActivationReconciler.test.ts",
  "server/modules/onboarding/whatsappLeadService.test.ts",
  "server/modules/onboarding/whatsappOnboardingErrors.test.ts",
  "server/modules/billing/accessPolicy.test.ts",
  "server/modules/billing/billingWebCheckoutAttempt.test.ts",
  "server/modules/billing/catalogPolicy.test.ts",
  "server/modules/billing/catalogService.test.ts",
  "server/modules/billing/commercialIdentity.auditRemediation.test.ts",
  "server/modules/billing/professionalCapacityRead.test.ts",
  "server/modules/billing/professionalCoveragePolicy.test.ts",
  "server/modules/billing/professionalCoverageService.test.ts",
  "server/modules/billing/providerEvents.test.ts",
  "server/modules/billing/providerLifecycleHooks.test.ts",
  "server/modules/billing/subscriptionLifecycle.audit-remediation.test.ts",
  "server/modules/billing/subscriptionLifecycle.regression.test.ts",
  "server/modules/billing/subscriptionLifecycle.test.ts",
  "server/modules/billing/subscriptionLifecycleRemediation.test.ts",
  "server/modules/billing/webPublic.multitab.test.ts",
  "server/modules/billing/webPublic.publicBoundary.test.ts",
  "server/modules/billing/webPublic.test.ts",
  "server/modules/billing/asaas/adapter.schedule.test.ts",
  "server/modules/billing/asaas/adapter.test.ts",
  "server/modules/billing/asaas/lifecycleHooks.test.ts",
  "server/modules/billing/asaas/mutationGuard.test.ts",
  "server/modules/billing/asaas/operationStore.test.ts",
] as const;

const tidbCommands = [
  ["db:test:whatsapp-onboarding-activation"],
  ["db:test:whatsapp-active-phone-migration"],
  ["db:test:billing"],
] as const;

const forbiddenMarkers = [
  /\b(?:describe|it|test)\.(?:skip|todo)\s*\(/,
  /\b(?:xdescribe|xit|xtest)\s*\(/,
] as const;

function validateContract() {
  const failures: string[] = [];

  for (const path of unitSuites) {
    if (!existsSync(path)) {
      failures.push(`${path}: arquivo de prova ausente`);
      continue;
    }

    const source = readFileSync(path, "utf8");
    if (!/\b(?:describe|it|test)\s*\(/.test(source)) {
      failures.push(`${path}: nenhuma prova Vitest executavel foi encontrada`);
    }

    for (const marker of forbiddenMarkers) {
      if (marker.test(source)) {
        failures.push(`${path}: contem skip/todo desabilitando cenario obrigatorio`);
      }
    }
  }

  const tidbFiles = [
    "scripts/test-whatsapp-onboarding-activation-tidb.ts",
    "scripts/test-whatsapp-active-phone-migration-tidb.ts",
    "scripts/test-billing-catalog-upgrade-tidb.ts",
    "scripts/test-billing-persistence-tidb.ts",
    "scripts/test-professional-capacity-alert-lifecycle-tidb.ts",
    "scripts/test-asaas-concurrency-tidb.ts",
    "scripts/test-billing-subscription-lifecycle-tidb.ts",
    "scripts/test-usage-governance-retention-tidb.ts",
  ] as const;

  for (const path of tidbFiles) {
    if (!existsSync(path)) failures.push(`${path}: gate TiDB ausente`);
  }

  if (failures.length > 0) {
    console.error("[issue-217] contrato de regressao invalido:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`[issue-217] contrato valido: ${unitSuites.length} suites Vitest e ${tidbFiles.length} gates TiDB rastreados.`);
  console.log("[issue-217] gate incremental: a #217 permanece aberta ate a cobertura vinculante de rollout da #898 existir e ser incorporada a regressao.");
}

function run(command: string, args: readonly string[]) {
  const result = spawnSync(command, [...args], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runUnitRegression() {
  run("pnpm", [
    "exec",
    "vitest",
    "run",
    "--maxWorkers=1",
    "--minWorkers=1",
    ...unitSuites,
  ]);
}

function runTidbRegression() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL e obrigatoria para executar a regressao TiDB da issue #217");
  }

  for (const [script] of tidbCommands) run("pnpm", [script]);
}

const args = new Set(process.argv.slice(2));
const contractOnly = args.has("--contract-only");
const tidbOnly = args.has("--tidb-only");
const withTidb = args.has("--with-tidb");

validateContract();

if (!contractOnly && !tidbOnly) runUnitRegression();
if (tidbOnly || withTidb) runTidbRegression();
