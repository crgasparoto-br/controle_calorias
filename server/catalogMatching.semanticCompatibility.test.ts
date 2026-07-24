import { describe, expect, it } from "vitest";
import { findCatalogFood } from "./catalogMatching";
import { isFoodCandidateSemanticallyCompatible } from "./foodSemanticCompatibility";
import { findTacoFood } from "./tacoLookup";
import { findCatalogFood as findWhatsappCatalogFood } from "./modules/whatsapp/intent/catalogLookup";

const UNSWEETENED_COFFEE_NAMES = [
  "Café sem açúcar",
  "café puro",
  "café preto",
  "café natural",
];

describe("compatibilidade semântica do catálogo", () => {
  it.each([
    "café com açúcar",
    "café adoçado",
    "café açucarado",
    "café com leite",
    "café com mel",
    "café com creme",
    "café com leite condensado",
    "café",
  ])("rejeita Café sem açúcar para %s", sourceText => {
    expect(
      isFoodCandidateSemanticallyCompatible(sourceText, UNSWEETENED_COFFEE_NAMES),
    ).toBe(false);
    expect(findCatalogFood(sourceText)?.slug).not.toBe("cafe-sem-acucar");
    expect(findWhatsappCatalogFood(sourceText)?.slug).not.toBe("cafe-sem-acucar");
  });

  it.each([
    "café sem açúcar",
    "cafe sem acucar",
    "café sem adição de açúcar",
    "café puro",
    "café preto",
  ])("mantém a referência de baixa caloria para %s", sourceText => {
    const match = findCatalogFood(sourceText);
    expect(match?.slug).toBe("cafe-sem-acucar");
    expect(findWhatsappCatalogFood(sourceText)?.slug).toBe("cafe-sem-acucar");
  });

  it("não permite que fuzzy matching inverta o qualificador de açúcar", () => {
    expect(findCatalogFood("café com açucar")?.slug).not.toBe("cafe-sem-acucar");
    expect(findCatalogFood("cafe sem acucar")?.slug).toBe("cafe-sem-acucar");
  });

  it("aplica o mesmo guard ao fallback TACO", () => {
    expect(findTacoFood("café com açúcar")?.name).not.toMatch(/sem açúcar/i);
    expect(findTacoFood("café")?.name).not.toMatch(/sem açúcar/i);
  });

  it("não confunde os dois cafés da regressão", () => {
    const sweetened = findCatalogFood("1 xícara de café com açúcar");
    const unsweetened = findCatalogFood("1 xícara de café sem açúcar");

    expect(sweetened?.slug).not.toBe("cafe-sem-acucar");
    expect(unsweetened?.slug).toBe("cafe-sem-acucar");
  });
});
