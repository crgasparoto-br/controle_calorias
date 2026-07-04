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
    ["Ovo mexido", "", "🥚"],
    ["Frango grelhado", "", "🍗"],
    ["Filé de tilápia", "", "🐟"],
    ["Arroz e feijão", "", "🍚"],
    ["Macarrão ao molho", "", "🍝"],
    ["Pão francês", "", "🍞"],
    ["Queijo minas", "", "🧀"],
    ["Iogurte natural", "", "🥛"],
    ["Café com leite", "", "🥛"],
    ["Salada de alface", "", "🥗"],
    ["Batata cozida", "", "🥔"],
    ["Bolo de chocolate", "", "🍫"],
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

  it("mantém o fallback padrão para alimentos sem regra conhecida", () => {
    expect(resolveFoodIcon({ foodName: "farofa crocante", canonicalName: "" })).toBe(DEFAULT_FOOD_ICON);
  });
});
