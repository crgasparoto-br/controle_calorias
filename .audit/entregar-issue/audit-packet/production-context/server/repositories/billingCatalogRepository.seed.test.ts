import { describe, expect, it } from "vitest";
import { buildBillingCatalogSeedId } from "./billingCatalogRepository";

describe("billing catalog seed identity", () => {
  it("keeps deterministic seed ids within varchar(64) for maximum catalog codes", () => {
    const productCode = `seed-${"p".repeat(115)}`;
    const versionCode = `seed-${"v".repeat(186)}`;

    expect(productCode).toHaveLength(120);
    expect(versionCode).toHaveLength(191);

    const productId = buildBillingCatalogSeedId("product", productCode);
    const versionId = buildBillingCatalogSeedId("version", versionCode);

    expect(productId).toHaveLength(64);
    expect(versionId).toHaveLength(64);
    expect(productId).toMatch(/^[a-f0-9]{64}$/);
    expect(versionId).toMatch(/^[a-f0-9]{64}$/);
    expect(buildBillingCatalogSeedId("product", productCode)).toBe(productId);
    expect(buildBillingCatalogSeedId("version", versionCode)).toBe(versionId);
    expect(productId).not.toBe(versionId);
  });
});
