/**
 * Capability consumers resolve credentials before reaching their mocked adapter.
 * Provide a non-secret test default without overriding scenarios that explicitly
 * set or delete provider credentials inside the test itself.
 */
process.env.OPENAI_API_KEY ??= "test-openai-key";
