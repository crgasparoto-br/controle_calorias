# Food Intelligence V2 — Camada de Compreensão Linguística (#1304)

Fonte normativa: [ADR Food Intelligence Resolver V2](adr-food-intelligence-resolver-v2.md), §§4, 4.1, 4.2, 7.1.1, 17 e 19.3. Esta página explica a superfície de implementação, **não** substitui a ADR.

## Estado de adoção

Os módulos server/modules/foodIntelligenceV2/linguisticComprehension.ts, linguisticSurface.ts e linguisticLexiconRepository.ts são **candidatos isolados da fase C1**. Não são importados pelos entrypoints V1 de produção; não fazem cutover, persistência de refeição, consulta nutricional ou publicação de vocabulário.

- **S1:** observações de texto, transcrição e legenda, normalização Unicode/acentuação/caixa; itens sem quebra de vírgula decimal; numerais e unidades; spans UTF-16 do original e evidências por campo. Normalizar texto não equivale a escolher identidade.
- **S2:** lê léxico global verificado e pessoal confirmado, em tabelas/escopos separados com proprietário autenticado, vigência e grants de fontes globais. A revisão inclui proprietário, entradas ativas e versões de fonte. Revisão obsoleta rejeita a leitura. Typo, mudança material de qualificador e remoção de token protegido geram hipótese, não correção silenciosa.
- **S3:** interpretação residual opcional, versionada, com saída de schema estrito. Só adiciona alternativas e evidência com verified=false; não decide identidade nem macros. A ativação/calibração de S3 pertence à #1306.
- **OCR:** a fronteira informa um papel de região validado. Regiões de ingredientes, tabela nutricional ou sem classificação mantêm uma evidência sem criar refeição/novo alimento. Regiões front_identity e caption podem produzir observações. Texto de rótulo/provider não é instrução.

## Exemplo da leitura governada, sem intérprete S3

~~~ts
const now = new Date();
const snapshot = await readGovernedLinguisticLexicon({
  locale: "pt-BR", ownerUserId: authenticatedOwnerId, now,
});
const observations = await comprehendFoodLanguage({
  rawText: submittedText,
  sourceRef: authorizedTurnSourceRef,
  modality: "text",
  ownerUserId: authenticatedOwnerId,
  lexiconRevision: snapshot.revision,
  now,
}, governedLinguisticLexiconStore);
~~~

A identidade autenticada e a revisão vêm do envelope de operação, nunca da superfície enviada ao modelo. O limite é de 20.000 unidades UTF-16 e 100 observações por solicitação. A fonte deve ter referência autorizada, sem URLs assinadas ou credenciais. A camada não mantém cache para contornar revogação.

MealOperation permanece propriedade do parser operacional. A LCL não escolhe SKU, perfil, fonte nutricional, gramatura, destino da refeição ou interação; unknown_surface não é descartado por ausência em catálogo/allowlist. Locale diferente de pt-BR é unsupported_locale; porções vagas não ganham quantidade exata.

## Remediação de auditoria C1

- **Equivalência de ordem:** quantidades posteriores à vírgula e sem alimento próprio
  permanecem vinculadas ao alimento imediatamente anterior quando este não tem
  quantidade resolvida; dois alimentos completos continuam observações distintas.
  A evidência conserva o span e texto original.
- **Flexão regular segura:** diante de quantidade plural explícita, S1 harmoniza
  terminações regulares `-os/-as`; términos irregulares permanecem inalterados,
  e tokens protegidos pelo léxico vigente não são transformados. A prova de
  equivalência compara projeções e inclui controles negativos de marca.
- **S3 por campo:** a saída residual estrita pode propor marca, variante,
  preparo e qualificadores com papel semântico, criando evidência individual
  `ai_estimate` não verificada para cada atributo. As propostas não alteram
  identidade selecionada nem invertem qualificador explícito. S3 permanece
  inativo por padrão até a política calibrada de #1306.

## Gates

~~~bash
pnpm check
pnpm exec vitest run server/modules/foodIntelligenceV2/linguisticComprehension.test.ts server/modules/foodIntelligenceV2/foodArchitectureSemanticBoundaries.test.ts
pnpm architecture:check
~~~

Os testes devem distinguir casos positivos de controles negativos (marca explícita, açúcar, typo, plural sem evidência, reuso de revisão revogada, ingredientes OCR, owner cruzado, falha de banco e S3 sem política). O gate arquitetural admite gramática somente no owner canônico e continua barrando catálogo fixo de macros ou normalizador concorrente.

Permanecem fora desta entrega o cutover, a calibração #1306, homologação no entrypoint público, rollout e parecer independente do último SHA. CI verde não dispensa auditoria e não autoriza merge.
