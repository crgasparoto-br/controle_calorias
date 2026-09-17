import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function source(relativePath: string) {
  const absolutePath = resolve(root, relativePath);
  expect(existsSync(absolutePath), `${relativePath} deve existir`).toBe(true);
  return readFileSync(absolutePath, "utf8");
}

function expectSourceIncludes(relativePath: string, pattern: RegExp) {
  const contents = source(relativePath);
  expect(contents).toMatch(pattern);
}

describe("Issue #1096 — reachability dos bridges do WhatsApp", () => {
  it("mantém a cadeia do POST público até a implementação final sem bypass", () => {
    const bootstrap = source("server/_core/index.ts");
    const publicRoute = source("server/whatsappPublicRoute.ts");
    const persistent = source("server/whatsappPersistentContextWebhook.ts");
    const idempotency = source("server/whatsappImageIdempotencyWebhook.ts");
    const intent = source("server/whatsappIntentWebhook.ts");
    const annotatedFacade = source("server/whatsappAnnotatedImageWebhook.ts");
    const annotatedImplementation = source(
      "server/whatsappAnnotatedImageWebhookImplementation.ts"
    );
    const facade = source("server/whatsappWebhook.ts");
    const implementation = source("server/whatsappWebhookImplementation.ts");

    expect(bootstrap).toMatch(
      /registerWhatsAppPublicPostRoute\(app,\s*\{[\s\S]*handle:\s*handleWhatsAppPersistentContextWebhook/
    );
    expect(publicRoute).toMatch(
      /options\.handle \?\? handleWhatsAppPersistentContextWebhook/
    );
    expect(persistent).toMatch(/from "\.\/whatsappImageIdempotencyWebhook"/);
    expect(persistent).toMatch(
      /handleWhatsAppWebhookWithImageIdempotency\(req, res\)/
    );
    expect(idempotency).toMatch(/from "\.\/whatsappIntentWebhook"/);
    expect(idempotency).toMatch(
      /handleWhatsAppWebhookWithTextIntent\(req, res\)/
    );
    expect(intent).toMatch(/from "\.\/whatsappAnnotatedImageWebhook"/);
    expect(intent).toMatch(
      /handleWhatsAppWebhookWithAnnotatedImages\(req, res\)/
    );
    expect(annotatedFacade).toMatch(
      /from "\.\/whatsappAnnotatedImageWebhookImplementation"/
    );
    expect(annotatedFacade).toMatch(
      /handleWhatsAppWebhookWithAnnotatedImagesImplementation\(req, res\)/
    );
    expect(annotatedImplementation).toMatch(/from "\.\/whatsappWebhook"/);
    expect(annotatedImplementation).toMatch(
      /return handleWhatsAppWebhook\(req, res\)/
    );
    expect(facade).toMatch(/from "\.\/whatsappWebhookImplementation"/);
    expect(facade).toMatch(/handleWhatsAppWebhookImplementation\(req, res\)/);
    expect(implementation).toMatch(/processMealInput/);
  });

  it("preserva a fachada F0-05 e seus contratos de compatibilidade", () => {
    const facade = source("server/whatsappWebhook.ts");
    const annotatedFacade = source("server/whatsappAnnotatedImageWebhook.ts");
    const annotatedImplementation = source(
      "server/whatsappAnnotatedImageWebhookImplementation.ts"
    );

    expect(facade).toMatch(/export function handleWhatsAppWebhook/);
    expect(facade).toMatch(/export \{[\s\S]*verifyWhatsAppWebhook/);
    expect(annotatedFacade).toMatch(
      /export function handleWhatsAppWebhookWithAnnotatedImages/
    );
    expect(annotatedImplementation).toMatch(
      /export function __resetWhatsAppAnnotatedImageDeduplicationForTests/
    );
    expect(annotatedFacade).toMatch(
      /export \{ __resetWhatsAppAnnotatedImageDeduplicationForTests \}/
    );

    const publicRoute = source("server/whatsappPublicRoute.ts");
    expect(publicRoute).toMatch(/app\.post\(/);
    expect(publicRoute).toMatch(/\/api\/whatsapp\/webhook/);
  });

  it("mantém os adaptadores históricos apenas enquanto seus consumidores existem", () => {
    const identityPreflight = source(
      "server/commercialFoodIdentityPreflight.ts"
    );
    const countableQuantity = source("server/countableFoodQuantity.ts");
    const canonicalAddition = source(
      "server/modules/whatsapp/intent/canonicalFoodAdditionResolution.ts"
    );
    const compatibilityTests = source(
      "server/countableFoodQuantity.issue997.test.ts"
    );

    expect(identityPreflight).toMatch(
      /export async function recoverCanonicalCommercialIdentity/
    );
    expect(identityPreflight).toMatch(
      /export function resolveStructuredCommercialIdentity/
    );
    expect(canonicalAddition).toMatch(/resolveStructuredCommercialIdentity/);
    expect(countableQuantity).toMatch(
      /export function prepareCountableFoodRegistration/
    );
    expect(countableQuantity).toMatch(
      /export async function prepareCountableFoodRegistrationResolved/
    );
    expect(compatibilityTests).toMatch(/prepareCountableFoodRegistration/);
  });

  it("mantém a evidência documental coerente com o código e com os golden flows", () => {
    const evidence = source("docs/testing/issue-1096-bridge-reachability.md");
    const ingestion = source("docs/design-docs/whatsapp-ingestion.md");
    const nutritionEngine = source("docs/design-docs/nutrition-engine.md");
    const architecture = source("ARCHITECTURE.md");
    const characterization = source(
      "server/whatsappWebhook.issue1094.characterization.test.ts"
    );

    expect(evidence).toContain("b3156bcf28cf854b14a657f4750a3f78b2a5ac67");
    expect(evidence).toContain("4d86cb814ff57164ff16cd7626ea21be46719fce");
    expect(evidence).toContain("O conjunto de remoções aprovado é vazio");
    expect(evidence).toContain("F0-05 permanece `keep`");
    expect(evidence).toContain("F0-06 e F0-08 permanecem `defer`");
    expect(evidence).toContain(
      "whatsappWebhook.issue1094.characterization.test.ts"
    );
    expect(ingestion).toContain("POST /api/whatsapp/webhook");
    expect(ingestion).toContain("handleWhatsAppPersistentContextWebhook");
    expect(nutritionEngine).toContain(
      "b3156bcf28cf854b14a657f4750a3f78b2a5ac67"
    );
    expect(nutritionEngine).toContain("F0-05 = `keep`");
    expect(nutritionEngine).toContain("F0-06 = `defer`");
    expect(nutritionEngine).toContain("F0-08 = `defer`");
    expect(nutritionEngine).toContain(
      "docs/testing/issue-1096-bridge-reachability.md"
    );
    expect(architecture).toContain("whatsappPersistentContextWebhook.ts");
    expect(architecture).toContain("whatsappWebhook.ts` permanece");
    expect(characterization).toContain("registerWhatsAppPublicPostRoute");
    expect(characterization).toContain("17");
  });
});
