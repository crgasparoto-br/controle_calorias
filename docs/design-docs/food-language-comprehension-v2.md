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
  concordâncias multi-termo regulares `-os/-as`; flexão isolada sem prova,
  marcas desconhecidas e términos irregulares permanecem inalterados,
  e tokens protegidos pelo léxico vigente não são transformados. A prova de
  equivalência compara projeções e inclui controles negativos de marca.
- **S3 por campo:** a saída residual estrita pode propor marca, variante,
  preparo e qualificadores com papel semântico, criando evidência individual
  `ai_estimate` não verificada para cada atributo. As propostas não alteram
  identidade selecionada nem invertem qualificador explícito. S3 permanece
  inativo por padrão até a política calibrada de #1306.

## Remediação AUD1304 A-004–A-007

- S2 preserva as polaridades explícitas de lactose, glúten, sal, gordura e cafeína,
  além do açúcar: alias que altera atributo material gera hipótese.
- S3 confronta o nome sugerido e os qualificadores estruturados com a superfície
  observada; uma contradição degrada explicitamente a interpretação residual.
- S1 harmoniza plurais regulares isolados em minúsculas, sem reescrever
  nomes capitalizados que podem indicar marcas. Identidade comercial incerta
  continua no léxico governado e no resolvedor posterior.
- Enquadramento de refeição, inclusive destino ao fim sem verbo inicial, não
  integra o nome alimentar. O parser canônico continua único dono de MealOperation.

## Remediação AUD1304 A-008–A-009

- Enquadramento inicial `No almoço 2 ovos`, mesmo sem verbo, deixa somente `2 ovos` na superfície alimentar quando há quantidade e alimento verificáveis. O contexto original e offsets UTF-16 permanecem intactos; sem frase alimentar reconhecível, não se descarta texto.
- Um plural isolado não governado com término morfológico `-itos/-itas` pode ser também nome comercial imutável; S1 conserva a grafia normalizada independentemente de caixa, sem inventar singular. A resolução desse caso ambíguo pertence ao léxico governado/S2 e ao resolvedor posterior; plurais inequívocos e concordâncias múltiplas permanecem cobertos pelos testes.

## Remediação AUD1304-NEW-001–003

- Numerais físicos com unidade contígua (`100g`, `250ml`) convergem com a grafia espaçada, sem consumir prefixos de marcas nem números com separadores ambíguos; a superfície e os spans originais permanecem intactos.
- A conjunção `e` separa itens alimentares completos mesmo quando o segundo não tem numeral. Construtos de quantidade como `uma fatia e meia` e `um e meio` não são divididos.
- Léxico governado `unit_term` / `portion_term` atua no slot da unidade e não no nome do alimento: só termo ativo, escopo autorizado e unidade canônica conhecida podem converter; há registro S2 por ID e evidência por campo. Conflito de significados produz alternativas sem conversão silenciosa. Grants, revogação e revisão são validados pela leitura governada existente.

## Gates

~~~bash
pnpm check
pnpm exec vitest run server/modules/foodIntelligenceV2/linguisticComprehension.test.ts server/modules/foodIntelligenceV2/foodArchitectureSemanticBoundaries.test.ts
pnpm architecture:check
~~~

Os testes devem distinguir casos positivos de controles negativos (marca explícita, açúcar, typo, plural sem evidência, reuso de revisão revogada, ingredientes OCR, owner cruzado, falha de banco e S3 sem política). O gate arquitetural admite gramática somente no owner canônico e continua barrando catálogo fixo de macros ou normalizador concorrente.

Permanecem fora desta entrega o cutover, a calibração #1306, homologação no entrypoint público, rollout e parecer independente do último SHA. CI verde não dispensa auditoria e não autoriza merge.
