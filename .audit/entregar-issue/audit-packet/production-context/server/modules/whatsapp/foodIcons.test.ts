import { describe, expect, it } from "vitest";
import { DEFAULT_FOOD_ICON, resolveFoodIcon } from "./foodIcons";

describe("resolveFoodIcon", () => {
  it.each([
    ["Banana prata", "", "🍌"],
    ["Maçã argentina", "", "🍎"],
    ["Laranja pera", "", "🍊"],
    ["Morango", "", "🍓"],
    ["Uva verde", "", "🍇"],
    ["Abacate", "", "🥑"],
    ["Mamão formosa", "", "🍎"],
    ["Ovo mexido", "", "🥚"],
    ["Frango grelhado", "", "🍗"],
    ["Filé de tilápia", "", "🐟"],
    ["Arroz e feijão", "", "🍚"],
    ["Macarrão ao molho", "", "🍝"],
    ["Pão francês", "", "🍞"],
    ["Tapioca", "", "🍞"],
    ["Queijo minas", "", "🧀"],
    ["Iogurte natural", "", "🥛"],
    ["Café com leite", "", "🥛"],
    ["Chá mate", "", "☕"],
    ["Suco de uva", "", "🍇"],
    ["Salada de alface", "", "🥗"],
    ["Batata cozida", "", "🥔"],
    ["Bolo de chocolate", "", "🍫"],
    ["Castanha de caju", "", "🥜"],
    ["Azeite de oliva", "", "🧈"],
  ])("preserva o ícone conhecido para %s", (foodName, canonicalName, expectedIcon) => {
    expect(resolveFoodIcon({ foodName, canonicalName })).toBe(expectedIcon);
  });

  it("usa o nome canônico quando o nome original não traz a palavra-chave", () => {
    expect(resolveFoodIcon({ foodName: "proteína do prato", canonicalName: "Chicken breast" })).toBe("🍗");
  });

  it("normaliza acentos antes de aplicar as regras", () => {
    expect(resolveFoodIcon({ foodName: "salmão grelhado" })).toBe("🐟");
    expect(resolveFoodIcon({ foodName: "grão de bico cozido" })).toBe("🍚");
    expect(resolveFoodIcon({ foodName: "brócolis no vapor" })).toBe("🥗");
  });

  it.each([
    [{ foodName: "produto sem nome claro", category: "fruta" }, "🍎"],
    [{ foodName: "produto sem nome claro", classification: "vegetal" }, "🥗"],
    [{ foodName: "produto sem nome claro", category: "proteína" }, "🍗"],
    [{ foodName: "produto sem nome claro", category: "pescado" }, "🐟"],
    [{ foodName: "produto sem nome claro", tags: ["bebida"] }, "🥤"],
    [{ foodName: "produto sem nome claro", tags: ["ultraprocessado"] }, "🍫"],
    [{ foodName: "produto sem nome claro", classification: "oleaginosa" }, "🥜"],
  ])("usa categoria/classificação/tag como fallback determinístico", (input, expectedIcon) => {
    expect(resolveFoodIcon(input)).toBe(expectedIcon);
  });

  it("prioriza regra textual específica sobre categoria genérica", () => {
    expect(resolveFoodIcon({ foodName: "Banana prata", category: "bebida" })).toBe("🍌");
  });

  it("mantém o fallback padrão para alimentos sem regra conhecida", () => {
    expect(resolveFoodIcon({ foodName: "farofa crocante", canonicalName: "" })).toBe(DEFAULT_FOOD_ICON);
  });
});
