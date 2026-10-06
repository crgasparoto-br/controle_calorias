import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GoldenCorpus } from "./contracts";

/**
 * Verificação da **referência independente** de §4.1.8 e §17 contra a fonte
 * canônica real.
 *
 * Uma declaração de equivalência que só aponta uma string governada continua
 * sendo auto-atestada: o próprio corpus poderia inventar a seção. Aqui a
 * declaração é confrontada com os **bytes** da ADR canônica: cada `adrSection`
 * precisa existir como título no documento, e a versão do documento é fixada
 * por hash, de modo que qualquer mudança da fonte exige revalidação explícita.
 *
 * Este módulo lê arquivos e por isso é usado apenas pela verificação do corpus
 * (testes), nunca pelo runtime de medição.
 */

/** Caminho da fonte canônica, relativo à raiz do repositório. */
export const CANONICAL_REFERENCE_SOURCE = "adr-food-intelligence-resolver-v2";

export const CANONICAL_ADR_PATH =
  "docs/design-docs/adr-food-intelligence-resolver-v2.md";

/**
 * Hash SHA-256 da versão da ADR contra a qual as equivalências foram
 * declaradas. Alterar a ADR sem atualizar este pino **reprova** a verificação:
 * a referência precisa ser reexaminada, não herdada.
 */
export const CANONICAL_ADR_SHA256 =
  "9961f90f09e76465a892757f498dbcbcf616a6a6c97ab13706e55df6824c1671";

export interface CanonicalReference {
  readonly path: string;
  readonly hash: string;
  /** Números de seção existentes como título, sem o símbolo `§`. */
  readonly sections: readonly string[];
}

function repositoryRoot(): string {
  // .../server/modules/foodIntelligenceV2/corpus/referenceSource.ts
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

/** Lê a ADR canônica e extrai hash e títulos de seção. */
export function readCanonicalReference(rootDir?: string): CanonicalReference {
  const path = resolve(rootDir ?? repositoryRoot(), CANONICAL_ADR_PATH);
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  const sections = [
    ...new Set(
      [...text.matchAll(/^#{2,6}\s+(\d+(?:\.\d+)*)/gm)].map(match => match[1])
    ),
  ];
  return {
    path,
    hash: createHash("sha256").update(bytes).digest("hex"),
    sections,
  };
}

/** Seções declaradas pelo corpus, com o dono da declaração. */
export function declaredReferenceSections(
  corpus: GoldenCorpus
): { ownerId: string; declaredBy: string; section: string }[] {
  const declared: { ownerId: string; declaredBy: string; section: string }[] =
    [];
  for (const entry of corpus.cases) {
    if (!entry.equivalenceReference) continue;
    declared.push({
      ownerId: entry.caseId,
      declaredBy: entry.equivalenceReference.declaredBy,
      section: entry.equivalenceReference.adrSection.replace(/^§/, ""),
    });
  }
  for (const scenario of corpus.learningScenarios) {
    declared.push({
      ownerId: scenario.scenarioId,
      declaredBy: scenario.reference.declaredBy,
      section: scenario.reference.adrSection.replace(/^§/, ""),
    });
    // `adrSections` é declaração normativa como qualquer outra: apontar para
    // seção inexistente é drift, não nota livre.
    for (const section of scenario.adrSections) {
      declared.push({
        ownerId: scenario.scenarioId,
        declaredBy: "scenario.adrSections",
        section: section.replace(/^§/, ""),
      });
    }
  }
  for (const entry of corpus.cases) {
    for (const section of entry.adrSections) {
      declared.push({
        ownerId: entry.caseId,
        declaredBy: "case.adrSections",
        section: section.replace(/^§/, ""),
      });
    }
  }
  return declared;
}

/**
 * Seções declaradas que **não existem** na fonte canônica. Lista vazia é
 * ausência de divergência; qualquer item é declaração inventada.
 */
export function missingReferenceSections(
  corpus: GoldenCorpus,
  reference: CanonicalReference
): { ownerId: string; section: string }[] {
  const known = new Set(reference.sections);
  return declaredReferenceSections(corpus)
    .filter(item => !known.has(item.section))
    .map(item => ({ ownerId: item.ownerId, section: item.section }));
}
