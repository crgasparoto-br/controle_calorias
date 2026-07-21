import { describe, expect, it } from "vitest";
import { normalizeProfessionalAiProviderOutput } from "./aiProvider";

const input = {
  patientId: 41,
  startDate: "2026-07-01",
  endDate: "2026-07-07",
  mode: "summary" as const,
};

const sourceSignals = [
  {
    key: "current_period",
    label: "Período atual · Intervalo",
    value: "2026-07-01 a 2026-07-07",
    period: "current" as const,
    available: true,
  },
  {
    key: "current_record_frequency",
    label: "Período atual · Frequência de registros",
    value: "7 com registros | 0 sem registros | 7 dias no total",
    period: "current" as const,
    available: true,
  },
];

function providerOutput() {
  return {
    title: "Resumo do período",
    summary: "Resumo assistido.",
    summarySourceKeys: ["current_period"],
    facts: ["O peso aumentou 99 kg."],
    factSourceKeys: [["current_record_frequency"]],
    interpretations: ["A frequência foi consistente."],
    interpretationSourceKeys: [["current_record_frequency"]],
    missingData: ["Ausência inventada pelo provedor."],
    cautions: [],
    draft: null,
    educationalNotice: "Aviso do provedor.",
  };
}

describe("normalizeProfessionalAiProviderOutput", () => {
  it("replaces provider facts and missing-data claims with canonical backend values", () => {
    const result = normalizeProfessionalAiProviderOutput(
      input,
      providerOutput(),
      sourceSignals,
      {
        facts: ["7 de 7 dias possuem registros alimentares."],
        factSourceKeys: [["current_record_frequency"]],
      },
      []
    );

    expect(result.facts).toEqual([
      "7 de 7 dias possuem registros alimentares.",
    ]);
    expect(result.facts.join(" ")).not.toContain("99 kg");
    expect(result.missingData).toEqual([]);
    expect(result.educationalNotice).toContain("Não representa diagnóstico");
  });

  it("rejects an interpretation based on an unavailable signal", () => {
    const unavailableWater = {
      key: "current_water",
      label: "Período atual · Água",
      value: "Sem registros de água no período",
      period: "current" as const,
      available: false,
    };
    const output = {
      ...providerOutput(),
      interpretations: ["O consumo de água foi baixo."],
      interpretationSourceKeys: [["current_water"]],
    };

    expect(() =>
      normalizeProfessionalAiProviderOutput(
        input,
        output,
        [...sourceSignals, unavailableWater],
        {
          facts: ["7 de 7 dias possuem registros alimentares."],
          factSourceKeys: [["current_record_frequency"]],
        },
        ["Não há registros de água no período selecionado."]
      )
    ).toThrow("professional_ai_unavailable_source_reference");
  });
});
