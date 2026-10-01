import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isContainerObjectOnlyDescription } from "./mealContainerNoise";
import { scoreContainerContentFoodLikelihood } from "./mealContainerSemanticEvidence";

type TacoEntry = { name: string; aliases?: string[] };

const tacoCatalog = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "tacoCatalog.json"), "utf8"),
) as TacoEntry[];

/**
 * Issue #1282 — `mortadela` era o único alimento do catálogo TACO com score
 * lexical abaixo do limiar (0,069 < 0,1) e, por isso, o item era descartado
 * como ruído não alimentar: a refeição ficava vazia e o usuário recebia apenas o
 * erro genérico de inferência.
 */
describe("issue #1282 — termo de catálogo nunca é ruído não alimentar", () => {
  it("não descarta nenhum termo do catálogo TACO", () => {
    const flagged: string[] = [];
    for (const entry of tacoCatalog) {
      for (const term of [entry.name, ...(entry.aliases ?? [])]) {
        if (isContainerObjectOnlyDescription(term.toLowerCase())) {
          flagged.push(`${entry.name} :: ${term}`);
        }
      }
    }
    expect(flagged).toEqual([]);
  });

  it("mantém o classificador lexical como evidência de baixa margem isolada", () => {
    // A caracterização registra o gatilho real do defeito: o modelo lexical
    // isolado reprova `mortadela`. O contrato é que o catálogo prevaleça sobre
    // essa evidência, não que o score mude.
    expect(scoreContainerContentFoodLikelihood("mortadela")).toBeLessThan(0.1);
    expect(scoreContainerContentFoodLikelihood("presunto")).toBeGreaterThan(0.1);
  });

  it("preserva a precedência para frases que só contêm um alimento", () => {
    // Frases que apenas *contêm* um termo de catálogo continuam sendo decididas
    // pela evidência negativa, e não pelo match parcial.
    expect(isContainerObjectOnlyDescription("mortadela")).toBe(false);
    expect(isContainerObjectOnlyDescription("mortadela fatiada")).toBe(false);
    expect(isContainerObjectOnlyDescription("miolo de alcatra grelhado")).toBe(false);
    expect(isContainerObjectOnlyDescription("abobora cabotian cozida")).toBe(false);
    // O veto do catálogo exige que *todos* os tokens da frase pertençam ao
    // termo: um alimento cercado de material/objeto continua sendo ruído.
    expect(isContainerObjectOnlyDescription("papel aluminio com mortadela")).toBe(true);
    expect(isContainerObjectOnlyDescription("vidro de arroz")).toBe(true);
  });

  it("continua descartando descrições de recipiente e objeto", () => {
    expect(isContainerObjectOnlyDescription("prato")).toBe(true);
    expect(isContainerObjectOnlyDescription("mesa posta")).toBe(true);
    expect(isContainerObjectOnlyDescription("copo de vidro")).toBe(true);
    expect(isContainerObjectOnlyDescription("travessa de vidro")).toBe(true);
    expect(isContainerObjectOnlyDescription("panela de aluminio")).toBe(true);
    expect(isContainerObjectOnlyDescription("guardanapo")).toBe(true);
  });
});
