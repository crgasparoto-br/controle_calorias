import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type ScenarioProof = {
  id: string;
  file: string;
  title: string;
};

const requiredScenarioProofs: readonly ScenarioProof[] = [
  { id: "ONB-PUBLIC-CONFLICT", file: "server/auth.whatsappOnboarding.test.ts", title: "returns the same public error for existing-account and credential conflicts" },
  { id: "ONB-AUTH-LINK", file: "server/auth.whatsappOnboarding.test.ts", title: "requires an authenticated session before linking the proven WhatsApp token" },
  { id: "ONB-LINK-ACTOR", file: "server/auth.whatsappOnboarding.test.ts", title: "uses only the authenticated user as the account-link actor and returns backend commercial state" },
  { id: "ONB-GREETING-CANONICAL", file: "server/modules/onboarding/webGreetingService.test.ts", title: "usa a mensagem canônica de onboarding sem interpolar dados sensíveis" },
  { id: "ONB-GREETING-ELIGIBLE", file: "server/modules/onboarding/webGreetingService.test.ts", title: "envia mensagem para usuário novo com telefone e meta válidos" },
  { id: "ONB-RECONCILE-CENTRAL", file: "server/modules/onboarding/whatsappActivationReconciler.test.ts", title: "re-evaluates pending users through the central activation contract" },
  { id: "ONB-RECONCILE-RECOVERABLE", file: "server/modules/onboarding/whatsappActivationReconciler.test.ts", title: "keeps reconciliation failures recoverable without failing other users" },
  { id: "ONB-LEAD-ELIGIBILITY", file: "server/modules/onboarding/whatsappLeadService.test.ts", title: "continues and greets only after valid eligibility" },
  { id: "ONB-PENDING-NO-GREETING", file: "server/modules/onboarding/whatsappLeadService.test.ts", title: "persists pending_activation without greeting when access is denied" },
  { id: "ONB-CONCURRENT-CLAIM", file: "server/modules/onboarding/whatsappLeadService.test.ts", title: "allows only one concurrent completion claim for the same token" },
  { id: "ONB-RESUME", file: "server/modules/onboarding/whatsappLeadService.test.ts", title: "resumes an interrupted completion without creating a second account" },
  { id: "ONB-NO-ENUMERATION", file: "server/modules/onboarding/whatsappOnboardingErrors.test.ts", title: "does not enumerate whether an account exists" },
  { id: "BILL-ACCESS-PENDING", file: "server/modules/billing/accessPolicy.test.ts", title: "blocks protected domain procedures when eligibility is denied" },
  { id: "BILL-CHECKOUT-IDEMPOTENT", file: "server/modules/billing/billingWebCheckoutAttempt.test.ts", title: "reuses the same canonical key while an equivalent attempt is in flight" },
  { id: "BILL-CHECKOUT-CONFLICT", file: "server/modules/billing/billingWebCheckoutAttempt.test.ts", title: "blocks an incompatible plan, method or coupon while the current attempt is active" },
  { id: "BILL-CATALOG-CANONICAL", file: "server/modules/billing/catalogPolicy.test.ts", title: "defines the six approved commercial versions without frontend-derived values" },
  { id: "BILL-CATALOG-NO-AUTO-PUBLISH", file: "server/modules/billing/catalogPolicy.test.ts", title: "does not let range alerts or system automation publish a commercial version" },
  { id: "BILL-COUPON-PERSISTED-FACTS", file: "server/modules/billing/catalogService.test.ts", title: "previews coupon eligibility exclusively from persisted catalog and usage facts" },
  { id: "BILL-IDENTITY-DISTINCT", file: "server/modules/billing/commercialIdentity.auditRemediation.test.ts", title: "keeps plan code, product code and version code as distinct subscription fields" },
  { id: "BILL-CAPACITY-EXTENSION", file: "server/modules/billing/professionalCapacityRead.test.ts", title: "returns the confirmed 30-day extension horizon, canonical milestones and commercial review" },
  { id: "BILL-CAPACITY-NO-GROWTH", file: "server/modules/billing/professionalCoveragePolicy.test.ts", title: "never lets grandfathering increase the new-admission limit" },
  { id: "BILL-CAPACITY-MILESTONES", file: "server/modules/billing/professionalCoveragePolicy.test.ts", title: "emits the required 90-day warning milestones once they are due" },
  { id: "BILL-CAPACITY-CONFIRMED-START", file: "server/modules/billing/professionalCoverageService.test.ts", title: "anchors the initial 90-day capacity window before acknowledging contract confirmation" },
  { id: "BILL-PROVIDER-SANITIZE", file: "server/modules/billing/providerEvents.test.ts", title: "persists only normalized allowlisted metadata" },
  { id: "BILL-PROVIDER-NEUTRAL-HOOK", file: "server/modules/billing/providerLifecycleHooks.test.ts", title: "runs provider-specific post-start and financial enrichment without leaking provider types into the domain service" },
  { id: "BILL-COUPON-RELEASE-EXPIRE", file: "server/modules/billing/subscriptionLifecycle.audit-remediation.test.ts", title: "releases a still-reserved coupon when an unpaid subscription expires after recovery" },
  { id: "BILL-SUSPENDED-RECOVERY", file: "server/modules/billing/subscriptionLifecycle.regression.test.ts", title: "emits recovery even when the suspended subscription never had a prior paid competence" },
  { id: "BILL-PIX-NO-TRIAL", file: "server/modules/billing/subscriptionLifecycle.test.ts", title: "requires an explicit Pix trial waiver and never grants a Pix trial" },
  { id: "BILL-TRIAL-ANTIFRAUD", file: "server/modules/billing/subscriptionLifecycle.test.ts", title: "blocks trial replay by stable hashed identity" },
  { id: "BILL-LIFECYCLE-IDEMPOTENT", file: "server/modules/billing/subscriptionLifecycle.test.ts", title: "is idempotent, ignores stale failures and moves through grace, suspension and recovery" },
  { id: "BILL-TRANSITION-REPLACES-TRIAL", file: "server/modules/billing/subscriptionLifecycleRemediation.test.ts", title: "makes active migration replace trial and keeps historical migration ineligible" },
  { id: "BILL-MULTITAB-SAME-ATTEMPT", file: "server/modules/billing/webPublic.multitab.test.ts", title: "ignores different browser-generated keys and uses the same server canonical attempt" },
  { id: "BILL-PATIENT-PRIVACY", file: "server/modules/billing/webPublic.publicBoundary.test.ts", title: "does not serialize sponsor financial or capacity fields for a covered patient" },
  { id: "BILL-PIX-WAIVER-PUBLIC", file: "server/modules/billing/webPublic.test.ts", title: "requires explicit trial waiver for Pix Automático before calling the provider" },
  { id: "ASAAS-SCHEDULE-IDEMPOTENT", file: "server/modules/billing/asaas/adapter.schedule.test.ts", title: "aligns the provisional trial charge to the authoritative firstChargeAt and is mutation-idempotent" },
  { id: "ASAAS-CALL-ONCE", file: "server/modules/billing/asaas/adapter.test.ts", title: "uses one outbound checkout call and reuses persisted checkout" },
  { id: "ASAAS-LIFECYCLE-ALIGN", file: "server/modules/billing/asaas/lifecycleHooks.test.ts", title: "aligns a newly correlated trial to the provider-neutral firstChargeAt" },
  { id: "ASAAS-UNCERTAIN-NO-REPLAY", file: "server/modules/billing/asaas/mutationGuard.test.ts", title: "reconciles an uncertain outcome by GET-equivalent without repeating the mutation" },
  { id: "ASAAS-TERMINAL-AUTHORITY", file: "server/modules/billing/asaas/operationStore.test.ts", title: "treats only provider terminal checkout and Pix authorization outcomes as authoritative" },

  // #898 technical rollout contracts are now implemented on develop and are part of this regression.
  { id: "ROLLOUT-30D-WINDOW", file: "server/modules/billing/billingCommercialTransition.test.ts", title: "uses one immutable 30-day absolute transition window" },
  { id: "ROLLOUT-CUTOVER-PRECISION", file: "server/modules/billing/billingCommercialTransition.test.ts", title: "normalizes the cutover instant to the persisted second precision" },
  { id: "ROLLOUT-FROZEN-COHORT", file: "server/modules/billing/billingCommercialTransition.test.ts", title: "fingerprints the frozen cohort deterministically and changes on membership drift" },
  { id: "ROLLOUT-FIVE-MILESTONES", file: "server/modules/billing/billingCommercialTransition.test.ts", title: "plans the five binding communication milestones from the immutable window" },
  { id: "ROLLOUT-RETRY-CADENCE", file: "server/modules/billing/billingCommercialTransition.test.ts", title: "uses the required email and WhatsApp retry cadences" },
  { id: "ROLLOUT-CONFIRM-WRITE", file: "server/modules/billing/billingCommercialTransition.test.ts", title: "requires an exact cutover confirmation before mutating" },
  { id: "ROLLOUT-NO-EARLY-CUTOVER", file: "server/modules/billing/billingCommercialTransition.test.ts", title: "does not execute a cutover before its absolute instant" },
  { id: "ROLLOUT-NO-RENEW", file: "server/modules/billing/billingCommercialTransition.test.ts", title: "does not silently renew an already elapsed transition" },
  { id: "ROLLOUT-COHORT-STABLE", file: "server/modules/billing/billingRolloutAdmin.test.ts", title: "keeps cohort selection deterministic and stable across input ordering" },
  { id: "ROLLOUT-BLOCK-INCIDENT", file: "server/modules/billing/billingRolloutAdmin.test.ts", title: "blocks phase advancement on absolute incidents regardless of percentages" },
  { id: "ROLLOUT-REINFORCED-CONFIRM", file: "server/modules/billing/billingRolloutAdmin.test.ts", title: "requires reinforced confirmation for enforced progression and incident resume" },
  { id: "ROLLOUT-MANUAL-PROGRESSION", file: "server/modules/billing/billingRolloutAdmin.test.ts", title: "records manual progression only after evaluating the current rollout state" },
  { id: "ROLLOUT-PAUSE-APPEND-ONLY", file: "server/modules/billing/billingRolloutAdmin.test.ts", title: "records pause as an append-only control event" },
  { id: "ROLLOUT-ROLLBACK-SAFE", file: "server/modules/billing/billingRolloutAdmin.test.ts", title: "records rollback to open_access without mutating financial facts, subscriptions or capacity" },
  { id: "ROLLOUT-AUTH-READ", file: "server/modules/billing/billingRolloutAdminAuthorization.test.ts", title: "blocks rollout overview for a regular user" },
  { id: "ROLLOUT-AUTH-MUTATION", file: "server/modules/billing/billingRolloutAdminAuthorization.test.ts", title: "blocks rollout pause mutation for a regular user before any resolver effect" },
  { id: "ROLLOUT-SCHEMA-COHORT", file: "server/modules/billing/billingRolloutAdminSchemas.test.ts", title: "rejects empty cohort sources and out-of-range percentages" },
  { id: "ROLLOUT-SCHEMA-ROLLBACK", file: "server/modules/billing/billingRolloutAdminSchemas.test.ts", title: "requires explicit reinforced confirmation for rollback" },
  { id: "ROLLOUT-INTERNAL-FIRST", file: "server/modules/billing/billingNotificationCenter.test.ts", title: "persists delivery state before an external attempt and keeps the notification after channel failure" },
] as const;

const unitSuites = [...new Set(requiredScenarioProofs.map(proof => proof.file))];

const tidbFiles = [
  "scripts/test-whatsapp-onboarding-activation-tidb.ts",
  "scripts/test-whatsapp-active-phone-migration-tidb.ts",
  "scripts/test-billing-catalog-upgrade-tidb.ts",
  "scripts/test-billing-persistence-tidb.ts",
  "scripts/test-professional-capacity-alert-lifecycle-tidb.ts",
  "scripts/test-asaas-concurrency-tidb.ts",
  "scripts/test-billing-subscription-lifecycle-tidb.ts",
  "scripts/test-usage-governance-retention-tidb.ts",
  "scripts/test-billing-commercial-transition-tidb.ts",
] as const;

const forbiddenMarkers = [
  /\b(?:describe|it|test)\.(?:skip|todo)\s*\(/,
  /\b(?:xdescribe|xit|xtest)\s*\(/,
] as const;

function hasExecutableTestTitle(source: string, title: string) {
  return [
    `it("${title}"`,
    `test("${title}"`,
    `it('${title}'`,
    `test('${title}'`,
  ].some(marker => source.includes(marker));
}

function scenarioContractFailures(
  proofs: readonly ScenarioProof[],
  sourceFor: (path: string) => string | null
) {
  const failures: string[] = [];
  const ids = new Set<string>();
  const proofKeys = new Set<string>();

  for (const proof of proofs) {
    if (ids.has(proof.id)) failures.push(`${proof.id}: scenario id duplicado`);
    ids.add(proof.id);

    const proofKey = `${proof.file}\u0000${proof.title}`;
    if (proofKeys.has(proofKey)) failures.push(`${proof.id}: prova duplicada ${proof.file} :: ${proof.title}`);
    proofKeys.add(proofKey);

    const source = sourceFor(proof.file);
    if (source === null) {
      failures.push(`${proof.id}: arquivo de prova ausente: ${proof.file}`);
      continue;
    }
    if (!hasExecutableTestTitle(source, proof.title)) {
      failures.push(`${proof.id}: cenario obrigatorio ausente: ${proof.file} :: ${proof.title}`);
    }
  }

  return failures;
}

function validateScenarioGuardItself() {
  const syntheticProofs: readonly ScenarioProof[] = [
    { id: "SYN-A", file: "synthetic.test.ts", title: "keeps first required scenario" },
    { id: "SYN-B", file: "synthetic.test.ts", title: "keeps second required scenario" },
  ];
  const complete = 'it("keeps first required scenario", () => {});\nit("keeps second required scenario", () => {});';
  const completeFailures = scenarioContractFailures(syntheticProofs, () => complete);
  if (completeFailures.length !== 0) {
    throw new Error(`[issue-217] self-test do contrato falhou no controle positivo: ${completeFailures.join("; ")}`);
  }

  const missingSecond = 'it("keeps first required scenario", () => {});';
  const negativeFailures = scenarioContractFailures(syntheticProofs, () => missingSecond);
  if (negativeFailures.length !== 1 || !negativeFailures[0]?.startsWith("SYN-B:")) {
    throw new Error("[issue-217] self-test do contrato nao detectou a remocao de um cenario individual");
  }
}

function validateContract() {
  const failures: string[] = [];
  const sources = new Map<string, string>();

  validateScenarioGuardItself();

  for (const path of unitSuites) {
    if (!existsSync(path)) {
      failures.push(`${path}: arquivo de prova ausente`);
      continue;
    }

    const source = readFileSync(path, "utf8");
    sources.set(path, source);
    for (const marker of forbiddenMarkers) {
      if (marker.test(source)) failures.push(`${path}: contem skip/todo desabilitando cenario obrigatorio`);
    }
  }

  failures.push(
    ...scenarioContractFailures(requiredScenarioProofs, path => sources.get(path) ?? null)
  );

  for (const path of tidbFiles) {
    if (!existsSync(path)) failures.push(`${path}: gate TiDB ausente`);
  }

  if (failures.length > 0) {
    console.error("[issue-217] contrato de regressao invalido:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(
    `[issue-217] contrato valido: ${requiredScenarioProofs.length} cenarios rastreados em ${unitSuites.length} suites Vitest e ${tidbFiles.length} gates TiDB.`
  );
  console.log(
    "[issue-217] #898 tecnico esta coberto; o fechamento final permanece condicionado apenas a evidencias operacionais da #1024 que forem vinculantes para a #217."
  );
}

function run(
  command: string,
  args: readonly string[],
  envOverrides: NodeJS.ProcessEnv = {}
) {
  const result = spawnSync(command, [...args], {
    stdio: "inherit",
    env: { ...process.env, ...envOverrides },
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

function scratchDatabaseName(databaseUrl: string, suffix: string) {
  const url = new URL(databaseUrl);
  const rawBase = url.pathname.replace(/^\/+/, "") || "controle_calorias";
  const safeBase = rawBase.replace(/[^a-zA-Z0-9_]/g, "_");
  const marker = `_issue217_${suffix}`;
  return `${safeBase.slice(0, 64 - marker.length)}${marker}`;
}

function withDatabase(databaseUrl: string, database: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function resetDatabase(databaseUrl: string, database: string) {
  const mysql = await import("mysql2/promise");
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/";
  const connection = await mysql.createConnection({ uri: adminUrl.toString() });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.query(`CREATE DATABASE \`${database}\``);
  } finally {
    await connection.end();
  }
}

async function runTidbRegression() {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  if (!sourceDatabaseUrl) {
    throw new Error("DATABASE_URL e obrigatoria para executar a regressao TiDB da issue #217");
  }

  const onboardingDatabase = scratchDatabaseName(sourceDatabaseUrl, "onboarding");
  const billingDatabase = scratchDatabaseName(sourceDatabaseUrl, "billing");
  const onboardingDatabaseUrl = withDatabase(sourceDatabaseUrl, onboardingDatabase);
  const billingDatabaseUrl = withDatabase(sourceDatabaseUrl, billingDatabase);

  await resetDatabase(sourceDatabaseUrl, onboardingDatabase);
  console.log(`[issue-217] TiDB onboarding isolado em ${onboardingDatabase}.`);
  run("pnpm", ["db:test:whatsapp-onboarding-activation"], { DATABASE_URL: onboardingDatabaseUrl });
  run("pnpm", ["db:test:whatsapp-active-phone-migration"], { DATABASE_URL: onboardingDatabaseUrl });

  await resetDatabase(sourceDatabaseUrl, billingDatabase);
  console.log(`[issue-217] TiDB billing isolado em ${billingDatabase}.`);
  run("pnpm", ["exec", "drizzle-kit", "push", "--force"], { DATABASE_URL: billingDatabaseUrl });
  run("pnpm", ["db:test:billing"], { DATABASE_URL: billingDatabaseUrl });
  run("pnpm", ["exec", "tsx", "scripts/test-billing-commercial-transition-tidb.ts"], {
    DATABASE_URL: billingDatabaseUrl,
  });
}

const args = new Set(process.argv.slice(2));
const contractOnly = args.has("--contract-only");
const tidbOnly = args.has("--tidb-only");
const withTidb = args.has("--with-tidb");

validateContract();

if (!contractOnly && !tidbOnly) runUnitRegression();
if (tidbOnly || withTidb) await runTidbRegression();
