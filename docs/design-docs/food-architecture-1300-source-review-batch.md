# Issue #1300 — coorte de revisão de fontes (onda 1)

Esta coorte relaciona **72 ocorrências individuais** do inventário CI do SHA `b8c503b5eb3eeb636341bd078b8747b308c66892`, artefato GitHub Actions `12083249131`, às responsabilidades observadas no código-fonte. Os números em `entries` apontam para índices **zero-based** de `triage.pending` do JSON do inventário SHA-256 `sha256:656c8f70385c916ec16be88034c62a924fb7590fb2fd97fce4b7f72c3b21d949` (usar o digest completo no arquivo JSON compactado, não este resumo). Cada candidato tem localização, fingerprint, ocorrência ordinal e hash da linha nesse inventário.

O arquivo `food-architecture-1300-ui-review-compact.json.gz` contém a classificação por coortes e justificativas ligadas ao código. Verifique sua procedência usando o inventário da execução acima e a fonte Git antes de confiar nas entradas.

**Limitação:** revisão de fonte efetuada no contexto da implementação, não certificação independente, não teste integral de runtime e não isenção automática do gate. Em especial, as coortes de normalização de tipo de refeição e quantidade exigem comparação comportamental com o owner V2. O relatório original mantém os candidatos na fila até auditoria separada e conclusiva.

Como validar: `gzip -dc docs/design-docs/food-architecture-1300-ui-review-compact.json.gz`; consultar `entries: [[índice, classe], ...]` e a seção `categories`. Não alterar `architecture-debt.json` com base somente nessas classificações.
