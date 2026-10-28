# Evidência de calibração C3 — Issue #1306

Estado deste arquivo: **pré-registro preservado + resultados posteriores**. As faixas candidatas e regras de seleção abaixo foram fixadas antes de qualquer resultado; resultados medidos não reescrevem o pré-registro.

## Identidade

- Issue: #1306
- PR: #1332
- Base imutável: develop@f2ce431146614751c7b6e850e66ff5556e350e89
- Branch: feat/1306-food-v2-calibration
- Auditoria de origem: audit-rejection:798d8377-69e7-43a4-9a6a-623b07c79ffd
- Regra: nenhum resultado de holdout pode alterar candidatos ou critérios.

## Fontes

- Golden Food Corpus versionado da #1299: rótulos esperados independentes do resolvedor.
- TACO 4ª edição, NEPA/UNICAMP: fonte primária declarada para a composição por 100 g.
- Snapshot executado: server/tacoCatalog.json.
- Resolvedor real C2: server/modules/foodIntelligenceV2/resolver.ts.

A fonte primária TACO é pública e produzida pelo NEPA/UNICAMP. O snapshot do repositório não recebe, por isso, autorização automática para promoção global: licenciamento, governança e validade continuam sendo controles próprios.

## Campanha inicial v1, item 30 — arredondamento

Fronteira: valores canônicos internos antes de formatação de UI.

Calibração:
- Mortadela.
- Amendoim, grão, cru.

Holdout reservado:
- Iogurte, natural.
- Pêra, Williams, crua.

Superfícies equivalentes por perfil: 30 g e 0,03 kg. A equivalência física é declarada antes da execução e não depende da saída do resolvedor.

Candidatos:
- energia/kcal: 0; 1e-12; 1e-9; 1e-6; 0.001; 0.01; 0.1;
- proteína/carboidratos/gordura, em g: 0; 1e-12; 1e-9; 1e-6; 0.0001; 0.001; 0.01; 0.1.

Seleção: menor candidato que cubra todas as diferenças da calibração. Depois do lock, o mesmo valor precisa cobrir todo o holdout. Resultado de teste não significa aprovação nominal.

## Ampliação da campanha de arredondamento v2 (pré-registro 28/10/2026)

Esta extensão trata **RISK-001**, sem substituir o pré-registro, as medições ou o
holdout histórico v1 (2 perfis + 2 perfis, 30 g ↔ 0,03 kg).
A seleção da nova coorte e das quantidades foi depositada na issue **antes**
da primeira execução: [pré-registro #6478971288](https://github.com/crgasparoto-br/controle_calorias/issues/1306#issuecomment-6478971288).

- **Calibração v2:** 12 perfis TACO independentes da escolha do resolver;
  inclui Mortadela e Amendoim, além de arroz, queijo, banana, batata,
  pão, tomate, suco de laranja, chocolate, macarrão e ovo.
- **Holdout v2:** 12 perfis TACO reservados; inclui Iogurte e Pêra, além
  de feijão, abacate, aveia, biscoito, leite de cabra, mamão, alface,
  frango, carne bovina e margarina. Nenhum perfil TACO pode aparecer nos
  dois conjuntos, mesmo em outra quantidade.
- **Equivalências por perfil:** 30 g ↔ 0,03 kg, 125 g ↔ 0,125 kg e
  750 g ↔ 0,75 kg: **36 pares de calibração + 36 pares de holdout**.
  Cada comparação afirma também a quantidade e os quatro nutrientes
  calculados sobre o perfil TACO de 100 g, rejeitando falsos resultados
  iguais derivados de quantidade ou base nutricional errada.
- **Critério:** mesma grade original de candidatos, menor candidato que
  cubra os pares da calibração; holdout não participa da escolha.
  A CI publica `cohortRevision=c3-rounding-expanded-v2`,
  `calibrationFoodProfiles`, `holdoutFoodProfiles`, `quantityGrams` e
  as métricas de cada caso/candidato. O extrator bloqueia perfil repetido,
  quantidade ausente, casos redundantes e contagens inconsistentes.
- **Exclusões:** perfis sem qualquer nutriente central válido (por exemplo
  registros com os quatro campos zero) são inválidos para esta medição.
  Não representam um novo oráculo nutricional nem devem ser tratados como
  valor calórico zero real.
- **Limite:** ampliação de **equivalência numérica texto/quantidade**
  em fonte controlada; não comprova equivalência multimodal, segurança
  de decisão por fonte, materialidade, acurácia ≥95% ou amostragem
  populacional. Os itens ADR 2/7/8/17/19/22 continuam dependentes de
  rótulos independentes e/ou ensaios externos autorizados.
  O item 30 **permanece OPEN até aprovação nominal e evidência
  governada**. Nenhuma tolerância é aplicada em produção.

## Pré-registro integral dos parâmetros C3

A fonte executável é `C3_PRE_REGISTERED_PARAMETER_DEFINITIONS` em `calibration.test.support.ts`. Cada um dos 15 parâmetros possui baseline observado (ou `null` quando não existe valor V2 aprovado), candidatos concretos, critério de seleção anterior ao resultado e bloqueadores de evidência. Os intervalos abaixo são inclusivos; são **grades experimentais**, não valores aprovados.

| Parâmetro | Baseline de comparação | Candidatos pré-registrados | Critério anterior ao resultado |
| --- | --- | --- | --- |
| confiança fonte×campo | nenhum V2 aprovado | 0 a 1, passo 0,05 | zero aceitação incompatível; sem regressão; empate mais conservador |
| algoritmo textual | `v1-catalog-score` | `v1-exact-substring-only`; `v2-governed-lexical-score` | replay pareado; sem perda de marca/negação/variante; depois custo/latência |
| limite de candidatos | nenhum V2 aprovado | inteiros 1 a 20 | menor limite sem perder identidade/alternativa correta |
| similaridade semântica | V1 observado 0,82, não aprovado para V2 | 0 a 1, passo 0,05 | zero match incompatível; sem regressão; empate mais conservador |
| margem do topo | nenhum V2 aprovado | 0 a 1, passo 0,05 | menor margem que preserve empates materiais como ambíguos |
| S1/S2→S3 | nenhum V2 aprovado | 0 a 1, passo 0,05 | sem perda de qualidade; minimizar chamadas/custo/latência |
| dispersão familiar | nenhum V2 aprovado | 0 a 2, passo 0,1 | separar famílias seguras/intermediárias/inseguras sem estimativa insegura |
| política de âncora | nenhum V2 aprovado | `verified-generic-variant`; `verified-family-preparation`; `no-provisional-estimate` | nenhuma estimativa sem âncora verificada; preferir proveniência mais forte |
| impacto calórico | nenhum V2 aprovado | 0 a 900 kcal/100 g, passo 25 | não permitir estimativa rotulada como insegura; escolher limite mais conservador |
| escada de estimativa | nenhum V2 aprovado | `strict-no-estimate`; `estimate-low-only`; `estimate-low-and-intermediate-with-review` | zero fallback/estimativa não sustentada; maximizar utilidade sem regressão |
| materialidade kcal | nenhum V2 aprovado | 0 a 900 kcal/100 g, passo 25 | nenhuma divergência material rotulada pode virar imaterial |
| materialidade macros | nenhum V2 aprovado | 0 a 100 g/100 g, passo 5 | por macro/família, não esconder divergência material rotulada |
| família esparsa | nenhum V2 aprovado | inteiros 1 a 20 pares | mínimo de pares após estabilização sem falso imaterial |
| arredondamento energia | política atual OPEN/fail-closed | 0; 1e-12; 1e-9; 1e-6; 0,001; 0,01; 0,1 kcal | menor tolerância que cobre calibração; holdout só valida |
| arredondamento macros | política atual OPEN/fail-closed | 0; 1e-12; 1e-9; 1e-6; 0,0001; 0,001; 0,01; 0,1 g | menor tolerância por macro; holdout só valida |

IDs de algoritmo/política nesta tabela identificam configurações experimentais a comparar; não afirmam que uma configuração ainda bloqueada esteja implementada ou autorizada para produção. Se o ground truth requerido não existir, o plano permanece `OPEN` e nenhuma grade candidata pode ser promovida por si só.

## Ledger dos demais itens

| Item ADR | Medição pré-registrada | Condição para sair de OPEN |
| --- | --- | --- |
| 2 | contar rótulos de confiança por fonte×campo no corpus | amostra independente suficiente e matriz aprovada |
| 7 | inventariar famílias/âncoras governadas e perfis comparáveis | ground truth de família + âncora + impacto |
| 8 | confirmar consumo real do contrato semântico e comparação textual | replay textual×semântico com orçamento autorizado |
| 17 | confirmar elegibilidade S3 e chamadas observadas | trials reais, erros/custo/latência por modalidade |
| 19 | inventariar rótulos de política de estimativa | ground truth por família/âncora e negativos |
| 22 | inventariar rótulos de materialidade e qualidade de perfis por 100 g | pares comparáveis governados e hipótese validada |

A campanha executável registra as contagens e blockers em C3_OPEN_EVIDENCE_READINESS. Manter OPEN por blocker medido é preferível a promover número arbitrário.


## Resultado medido — campanha pré-registrada

A campanha é reexecutada pelo **Agent-first gate do HEAD material corrente**. O run ID e o SHA exatos são evidência remota da PR/Actions e não ficam congelados neste documento, evitando tratar uma medição ancestral como prova de um HEAD posterior. O teste emite o registro estruturado `C3_ITEM30_ROUNDING_CAMPAIGN` no mesmo run que executa a suíte.

Após o Vitest completo, o `run-vitest-shards.mjs` extrai e valida os três
marcadores `C3_ITEM30_ROUNDING_CAMPAIGN`, `C3_OPEN_EVIDENCE_READINESS` e
`C3_REAL_RESOLVER_FIXTURE_BASELINE`. O GitHub Actions publica o artefato
`food-v2-c3-calibration-<HEAD-SHA>` **também em execução bem-sucedida**,
com `calibration-evidence.json` (todos os candidatos, baseline, holdout e
bloqueios) e `manifest.json` (SHA exato, ID do run e SHA-256 do relatório).
Marcador ausente, duplicado, métrica contraditória ou holdout incompatível
impede que o CI completo passe. A coleta não reexecuta testes nem aprova
thresholds produtivos. Retenção do artefato: 30 dias.

A remediação **A-005** (`audit-rejection:027b0bf6-a235-40cb-8f20-bd29d50d9d32`)
reforça a verificação antes da escrita: `passed`/`failed` devem concordar com
`maxDelta` e a tolerância de cada candidato; as classes de falha de candidatos
somam os casos que falharam; e `calls`, totais de corpus, três splits,
contagens, taxas e classes do baseline devem ser coerentes. Classes de falha
do corpus podem se sobrepor no mesmo caso e, portanto, **não** são somadas
como partição exclusiva. A regressão em `scripts/run-vitest-shards.test.mjs`
rejeita métricas contraditórias sem gerar manifesto, mantém controles positivos
e inclui ataques irmãos além dos quatro cenários originais da auditoria.
O gate valida evidências, **não** aprova automaticamente nenhum threshold.

### Item 30 — resultado da campanha inicial v1, ainda não aprovado

Os quatro campos numéricos centrais do contrato V2 (`calories`, `protein`, `carbs`, `fat`) apresentaram **delta máximo 0** entre as superfícies fisicamente equivalentes `30 g` e `0,03 kg` nos perfis de calibração. Pelo critério pré-registrado, o menor candidato selecionado foi:

- energia: **0 kcal**;
- proteína: **0 g**;
- carboidratos: **0 g**;
- gordura: **0 g**.

O holdout reservado, aberto somente depois do lock, também apresentou delta máximo 0 para os quatro campos nos perfis `taco-iogurte-natural` e `taco-pera-williams-crua`. A regressão executável fixa esse resultado em `MEASURED_ITEM30_CANDIDATE` sem alterar `CORPUS_ROUNDING_TOLERANCE`: o valor medido **não é promovido para política aprovada** enquanto faltar aprovação nominal explícita exigida pela ADR §16.2/§25.

O relatório empírico agora registra **cada candidato** por nutriente com `cases`, `passed`, `failed`, `maxDelta` e `failuresByClass`; compara o candidato selecionado ao baseline atual `open-fail-closed-zero-divergence`; e publica as métricas do holdout somente para o valor já congelado. Um controle negativo sintético comprova que uma divergência acima do candidato aparece como `rounding_delta_exceeds_candidate:<campo>`, impedindo que uma média esconda falha por classe.

### Itens mantidos OPEN por evidência objetiva

A mesma execução mantém os demais recortes bloqueados sem escolher números:

- **2:** o Golden Food Corpus não possui rótulos independentes de confiança esperada por fonte × campo;
- **7:** não existe ground truth governado suficiente de família × âncora × impacto para calibrar os três eixos;
- **8:** o contrato de busca semântica residual ainda não é consumido pelo resolvedor e o orçamento de chamadas externas da campanha é zero; não existe replay textual × semântico autorizado;
- **17:** S3 permanece inelegível por default sem predicate calibrada e não houve trial externo autorizado de custo/latência/erro por modalidade;
- **19:** o corpus não rotula uma política esperada da escada de estimativa por família/âncora;
- **22:** o corpus não contém rótulos governados independentes de materialidade e pares de variantes suficientes para derivar imaterialidade com segurança.

Esses estados são resultados de prontidão, não aprovação. Nenhum deles autoriza threshold, fuzzy/semântico, S3, estimativa, materialidade ou rollout produtivo.
