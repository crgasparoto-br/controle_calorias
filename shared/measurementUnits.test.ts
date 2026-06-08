import { describe, expect, it } from "vitest";

import { normalizeMeasurementUnit } from "./measurementUnits";

describe("normalizeMeasurementUnit", () => {
  it("normaliza unidades padrao de peso e volume", () => {
    expect(normalizeMeasurementUnit("gr")).toBe("g");
    expect(normalizeMeasurementUnit("gramas")).toBe("g");
    expect(normalizeMeasurementUnit("mililitros")).toBe("ml");
    expect(normalizeMeasurementUnit("unidade")).toBe("un");
  });

  it("normaliza unidades caseiras e comerciais comuns", () => {
    expect(normalizeMeasurementUnit("fatias")).toBe("fatia");
    expect(normalizeMeasurementUnit("longneck")).toBe("long neck");
    expect(normalizeMeasurementUnit("latas")).toBe("lata");
    expect(normalizeMeasurementUnit("porcoes")).toBe("porção");
  });

  it("mantem medidas caseiras e comerciais livres", () => {
    expect(normalizeMeasurementUnit("scoop")).toBe("scoop");
    expect(normalizeMeasurementUnit("long neck")).toBe("long neck");
    expect(normalizeMeasurementUnit("lata")).toBe("lata");
    expect(normalizeMeasurementUnit("xícara grande")).toBe("xícara grande");
  });

  it("nao embute quantidade numerica na unidade normalizada", () => {
    const units = ["gramas", "mililitros", "fatias", "longneck"].map(normalizeMeasurementUnit);

    expect(units).toEqual(["g", "ml", "fatia", "long neck"]);
    expect(units.every(unit => !/\d/.test(unit))).toBe(true);
  });
});
