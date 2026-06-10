import { describe, expect, it } from "vitest";

import { parseWhatsAppWaterLine, splitWhatsAppWaterAndFoodText } from "./waterFoodText";

describe("waterFoodText", () => {
  it("identifica uma linha isolada de água com quantidade", () => {
    expect(parseWhatsAppWaterLine("300ml água")).toEqual({
      text: "300ml água",
      amountMl: 300,
    });
  });

  it("separa linhas de água das linhas de alimento em mensagem multi-linha", () => {
    expect(splitWhatsAppWaterAndFoodText("3 bisnaguinhas panco\n300ml água\n19g de mel")).toEqual({
      waterLines: [
        {
          text: "300ml água",
          amountMl: 300,
        },
      ],
      foodText: "3 bisnaguinhas panco\n19g de mel",
    });
  });

  it("não classifica texto comum como água", () => {
    expect(parseWhatsAppWaterLine("olá")).toBeNull();
    expect(splitWhatsAppWaterAndFoodText("olá\n3 bisnaguinhas panco")).toBeNull();
  });
});
