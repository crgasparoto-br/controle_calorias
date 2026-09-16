import { afterEach } from "vitest";

/**
 * Capability consumers resolve credentials before reaching their mocked adapter.
 * Provide deterministic, non-secret test defaults without allowing an ambient
 * developer endpoint to change the provider selected by mocked tests. Tests that
 * cover OpenAI-compatible behavior set these variables explicitly in their own
 * scope and are cleaned up by the afterEach below.
 */
if (!process.env.OPENAI_API_KEY?.trim()) {
  process.env.OPENAI_API_KEY = "test-openai-key";
}

delete process.env.OPENAI_BASE_URL;
delete process.env.AI_OPENAI_COMPATIBLE_OPERATIONS;
delete process.env.AI_OPENAI_COMPATIBLE_IMAGE_MODELS;

process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE ??= "memory";

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for("controle_calorias.usageProviderDispatchTestState")
  ];
  delete process.env.OPENAI_BASE_URL;
  delete process.env.AI_OPENAI_COMPATIBLE_OPERATIONS;
  delete process.env.AI_OPENAI_COMPATIBLE_IMAGE_MODELS;
});
