import { describe, expect, it } from "vitest";
import { goldenFoodCorpus } from "./data";
import { readCanonicalReference } from "./referenceSource";

/**
 * Independent domain assertions for high-risk historical regressions.
 * Deliberately not derived from expected decisions or the reference resolver.
 * These controls detect incorrect labels even when a harness matches its oracle.
 * This file does not claim external nutritional composition verification.
 */
describe("historical domain semantic controls", () => {
  const byId = new Map(goldenFoodCorpus.cases.map(entry => [entry.caseId, entry]));
  const get = (id: string) => {
    const entry = byId.get(id);
    expect(entry, `missing historical control: ${id}`).toBeDefined();
    return entry!;
  };
  const first = (id: string) => {
    const decisions = get(id).expected.decisions;
    expect(decisions, id).toHaveLength(1);
    return decisions[0];
  };

  it.each([
    ["c-leite-uht-integral", "leite", "Piracanjuba", "integral", 200, "ml"],
    ["c-pera-packham", "pêra", null, "packham", 1, "unidade"],
    ["c-pera-williams", "pêra", null, "williams", 1, "unidade"],
    ["c-maca-fuji", "maçã", null, "fuji", 1, "unidade"],
    ["c-leite-desnatado", "leite", null, "desnatado", 200, "ml"],
  ] as const)(
    "preserves externally specified material identity for %s",
    (id, name, brand, variant, value, unit) => {
      const decision = first(id);
      expect(decision.identity.canonicalName).toBe(name);
      expect(decision.identity.brand).toBe(brand);
      expect(decision.identity.variant).toBe(variant);
      expect(decision.quantity).toMatchObject({ value, unit });
      expect(decision.nextAction).toBe("propose");
    }
  );

  it("does not merge distinct cultivars, sugar profiles, or milk fat profiles", () => {
    expect(first("c-pera-packham").identity.variant).not.toBe(
      first("c-pera-williams").identity.variant
    );
    expect(first("c-leite-desnatado").identity.variant).not.toBe(
      first("c-leite-uht-integral").identity.variant
    );
    expect(first("c-refrigerante-zero").identity.qualifiers).toContain("zero");
    expect(first("c-refrigerante-comum").identity.qualifiers).not.toContain("zero");
    expect(get("c-refrigerante-comum").negativeControlOf).toBe("c-refrigerante-zero");
  });

  it("does not silently turn imprecise portions into gram weights", () => {
    for (const id of ["c-porcao-tiquinho", "c-porcao-punhado", "c-porcao-pratao"]) {
      const entry = get(id);
      expect(entry.decisionClass).toBe("clarification");
      const decision = first(id);
      expect(decision.nextAction).toBe("clarify");
      expect(decision.quantity.presence).toBe("forbidden");
      expect(decision.quantity.grams).toBeNull();
      expect(decision.clarification.requiredFields).toContain("quantity");
    }
  });

  it("preserves the confirmed coffee preference without assuming a portion", () => {
    const decision = first("c-cafe-sem-acucar-memoria");
    expect(decision.identity.canonicalName).toBe("café");
    expect(decision.identity.qualifiers).toContain("sem açúcar");
    expect(decision.quantity.presence).toBe("unspecified");
    expect(decision.nutrition.allowedOrigins).toContain("memory");
  });

  it("does not certify a generic nutrition profile for branded milk or zero soda", () => {
    for (const id of ["c-leite-uht-integral", "c-refrigerante-zero"]) {
      expect(first(id).nutrition.genericProfileMustNotBeVerified).toBe(true);
    }
    const zero = first("c-refrigerante-zero").nutrition;
    expect(zero.provisionalRequired).toBe(true);
    expect(zero.forbiddenOrigins).toContain("catalog");
  });

  it("rejects a non-food object without asserting a food identity", () => {
    const item = get("c-neg-pasta-de-dente");
    expect(item.decisionClass).toBe("rejection");
    const decision = first("c-neg-pasta-de-dente");
    expect(decision.nextAction).toBe("reject");
    expect(decision.identity.presence).toBe("forbidden");
    expect(decision.reasonCodes).toContain("non_food");
  });

  it("ties cited historical controls to the pinned canonical document", () => {
    const reference = readCanonicalReference();
    expect(reference.sections).toContain("4.1.8");
    expect(reference.sections).toContain("16");
    for (const id of [
      "c-leite-uht-integral", "c-pera-packham", "c-pera-williams",
      "c-maca-fuji", "c-cafe-sem-acucar-memoria", "c-refrigerante-zero",
      "c-leite-desnatado", "c-porcao-punhado", "c-neg-pasta-de-dente",
    ]) {
      const entry = get(id);
      expect(entry.incidentRefs.length, id).toBeGreaterThan(0);
      expect(entry.adrSections.length, id).toBeGreaterThan(0);
      for (const section of entry.adrSections)
        expect(reference.sections, `${id}: ${section}`).toContain(section.replace(/^§/, ""));
    }
  });
});
