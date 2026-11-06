import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nutritionEngine = readFileSync(
  new URL("../../../docs/design-docs/nutrition-engine.md", import.meta.url),
  "utf8"
);
const whatsappClarification = readFileSync(
  new URL(
    "../../../docs/design-docs/whatsapp-food-registration-clarification.md",
    import.meta.url
  ),
  "utf8"
);
const reliability = readFileSync(
  new URL("../../../docs/RELIABILITY.md", import.meta.url),
  "utf8"
);

describe("DOC-SEMANTIC-DRIFT-001 — policy #997", () => {
  it("keeps the #997 countable-portion contract stricter than general estimates", () => {
    expect(nutritionEngine).toMatch(
      /No escopo específico de medidas contáveis da issue #997, a conversão para gramas aceita somente massa\/volume explícitos ou porção canônica segura/
    );
    expect(whatsappClarification).toMatch(
      /Nos fluxos gerais de registro textual, medidas podem percorrer[\s\S]*?quando o contrato da interação permitir estimativas\. Para as medidas contáveis cobertas pela issue #997, a regra é mais estrita: somente massa\/volume explícitos ou porção canônica segura convertem `fatia`\/`unidade` em gramas; ausência de porção canônica abre clarificação persistente, sem usar estimativa pesquisada, aprendida, média ou contextual como substituto\./
    );
  });

  it("keeps B's partial initial registration and all-pending no-meal outcome explicit", () => {
    expect(nutritionEngine).toMatch(
      /A decisão B da #997 separa dois efeitos\. No \*\*registro textual inicial\*\* de uma refeição mista,[\s\S]*?segmentos[\s\S]*?itens foram omitidos[\s\S]*?Se a continuação falhar ao ser criada depois do save seguro,[\s\S]*?não se afirma que existe retomada/
    );
    expect(whatsappClarification).toMatch(
      /No registro textual inicial misto da política B,[\s\S]*?segmentos independentemente resolvidos[\s\S]*?cada omitido deve ser listado[\s\S]*?pergunta de quantidade durável[\s\S]*?Se a criação da continuação falhar após o save seguro,[\s\S]*?nenhuma pendência foi guardada[\s\S]*?Se nenhum segmento estiver resolvido, nenhuma refeição ou draft é criado[\s\S]*?não altera o contrato separado de registro por imagem/
    );
    expect(reliability).toMatch(
      /Na política B específica do registro textual inicial misto da #997,[\s\S]*?Se a criação dessa continuação falhar depois do save seguro,[\s\S]*?não há pendência persistida/
    );
  });

  it("does not generalize initial partial persistence to later compound adjustments", () => {
    expect(nutritionEngine).toMatch(
      /Essa exceção não se estende a \*\*ajustes compostos\*\*[\s\S]*?Nenhuma operação do ajuste pode ser aplicada até que todas as operações sejam resolvidas/
    );
    expect(whatsappClarification).toMatch(
      /Essa possibilidade de registro parcial é específica da criação inicial e não relaxa a atomicidade do ajuste de uma refeição já existente:[\s\S]*?nenhuma operação do mesmo comando é persistida antes da resolução completa/
    );
  });

  it("fails closed if a composed adjustment would cross multiple meals", () => {
    expect(nutritionEngine).toMatch(
      /um comando composto da #997 só pode alterar uma refeição por operação transacional[\s\S]*?alvos resolvidos pertencerem a refeições diferentes[\s\S]*?bloqueado antes da primeira escrita/
    );
  });
});
