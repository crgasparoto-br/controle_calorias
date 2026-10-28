# Evidência de calibração C3 — Issue #1306

Estado deste arquivo: **pré-registro**, anterior ao primeiro resultado da campanha.

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

## Campanha item 30 — arredondamento

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
