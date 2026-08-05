import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("issue 925 canonical security and privacy documentation", () => {
  it("preserves the pre-existing transitive WhatsApp and provider security boundaries", () => {
    const security = read("docs/SECURITY.md");

    expect(security).toContain("Histórico persistido do WhatsApp é entrada não confiável");
    expect(security).toContain("### Fronteira dos consumidores #922");
    expect(security).toContain("### Fronteira dos consumidores #923");
    expect(security).toContain("### Fronteira de transcrição #924");
    expect(security).toContain("### Smokes e benchmarks com providers externos");
    expect(security).toContain("Código mutável de uma PR não pode receber secrets permanentes");
  });

  it("preserves the existing LGPD inventory, retention and professional isolation rules", () => {
    const privacy = read("docs/PRIVACY_LGPD.md");

    expect(privacy).toContain("## Contexto persistente do WhatsApp");
    expect(privacy).toContain("Rascunhos profissionais não salvos permanecem somente em memória");
    expect(privacy).toContain("### Transcrição de áudio e benchmark (#924)");
    expect(privacy).toContain("### Aplicação em refeição e intenção (#922)");
    expect(privacy).toContain("### Aplicação em pergunta, pesquisa nutricional e embedding (#923)");
  });

  it("documents the additive IMAGE_ANNOTATION security and LGPD contract", () => {
    const environment = read(".env.example");
    const security = read("docs/SECURITY.md");
    const privacy = read("docs/PRIVACY_LGPD.md");

    expect(environment).toContain("AI_OPENAI_COMPATIBLE_IMAGE_MODELS");
    expect(security).toContain("### Fronteira de anotação de imagem #925");
    expect(security).toContain("tamanho estimado antes da alocação do buffer decodificado");
    expect(security).toContain("AI_OPENAI_COMPATIBLE_IMAGE_MODELS");
    expect(privacy).toContain("### Anotação derivada da foto (#925)");
    expect(privacy).toContain("Original e derivado usam buffers e chaves de storage distintos");
  });
});
