import { afterEach } from "vitest";

/**
 * Capability consumers resolve credentials before reaching their mocked adapter.
 * Provide a non-secret test default without overriding scenarios that explicitly
 * set or delete provider credentials inside the test itself.
 */
process.env.OPENAI_API_KEY ??= "test-openai-key";

process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE ??= "memory";

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for("controle_calorias.usageProviderDispatchTestState")];
});
