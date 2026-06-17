import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function importMemoryFallbackModule() {
  vi.resetModules();
  return import("./memoryFallback");
}

describe("memory persistence fallback policy", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ALLOW_MEMORY_PERSISTENCE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("allows memory persistence during tests", async () => {
    process.env.NODE_ENV = "test";
    const { canUseMemoryPersistenceFallback } = await importMemoryFallbackModule();

    expect(canUseMemoryPersistenceFallback()).toBe(true);
  });

  it("allows explicit memory persistence outside production", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_MEMORY_PERSISTENCE = "true";
    const { canUseMemoryPersistenceFallback } = await importMemoryFallbackModule();

    expect(canUseMemoryPersistenceFallback()).toBe(true);
  });

  it("blocks explicit memory persistence in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_MEMORY_PERSISTENCE = "true";
    const { canUseMemoryPersistenceFallback } = await importMemoryFallbackModule();

    expect(canUseMemoryPersistenceFallback()).toBe(false);
  });
});
