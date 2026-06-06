import { describe, expect, it } from "vitest";

import { normalizeMeasurementUnit } from "./measurementUnits";

describe("normalizeMeasurementUnit", () => {
  it("normaliza unidades padrao de peso e volume", () => {
    expect(normalizeMeasurementUnit("gr")).toBe("g");
    expect(normalizeMeasurementUnit("gramas")).toBe("g");
    expect(normalizeMeasurementUnit("mililitros")).toBe("ml");
    expect(normalizeMeasurementUnit("unidade")).toBe("un");
  });

  it("mantem medidas caseiras e comerciais livres", () => {
    expect(normalizeMeasurementUnit("scoop")).toBe("scoop");
    expect(normalizeMeasurementUnit("long neck")).toBe("long neck");
    expect(normalizeMeasurementUnit("lata")).toBe("lata");
    expect(normalizeMeasurementUnit("xícara grande")).toBe("xícara grande");
  });
});
