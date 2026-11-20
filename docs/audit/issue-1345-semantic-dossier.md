# Issue #1345 — dossiê semântico de preparação (M1, sem certificação)

**Alvo:** [PR #1348](https://github.com/crgasparoto-br/controle_calorias/pull/1348), base `develop@0bee3eba`, branch `fix/1346-junit-evidence-reconcile`. **Estado intencional:** `review_state=incomplete`. Este dossiê NÃO certifica a issue nem substitui revisão em outra sessão.

## Fontes autenticadas e limites

- [Issue canônica #1345](https://github.com/crgasparoto-br/controle_calorias/issues/1345): 26 obrigações do texto vigente; inclui fatos históricos, M1 e M2.
- [Ensaio #44621447082](https://github.com/crgasparoto-br/controle_calorias/actions/runs/44621447082), SHA `fa08e8b`: coleta técnica `success`, certificação `failure`, corretamente bloqueada sem `certification-inputs.json`.
- [Artefato #14577416513](https://github.com/crgasparoto-br/controle_calorias/actions/runs/44621447082/artifacts/14577416513): índice factual de 25 shards/6.899 casos, nove skipped; não demonstra conclusão semântica.
- O [ensaio #44625200072](https://github.com/crgasparoto-br/controle_calorias/actions/runs/44625200072) no SHA anterior `61f5b76` executou 26 shards (24 Vitest, um Python e um Node), totalizando 6.984 casos JUnit, nove skipped e zero falhas/erros. A correção A-004 acrescenta quatro testes adversariais/contratuais ao conversor; os números do ensaio anterior **não** certificam o novo SHA e exigem nova coleta autenticada.
- [Contrato oficial fixado](https://github.com/crgasparoto-br/skill/tree/71217ab40be73f64180f253816d7b5214cb23100/entregar-issue): o produtor valida cada candidato, origem, bindings, relatórios e hash.

## Classificação por obrigação

`covered` é provisório e restrito aos controles técnicos M1, não uma declaração de conclusão da issue. `pending` é bloqueante. `not-applicable` é usado apenas em relatos contextuais ou históricos, nunca em critérios de aceite.

| Obrigação | Estado | Evidência ou próximo passo |
|---|---|---|
| OBL-001 | `pending` | Modelo decidido, mas ainda nao houve review em conversa separada autenticada. (`REQ-GOV-001`) |
| OBL-002 | `covered` | O coletor so aceita base develop; teste novo rejeita base main. (`REQ-M1-BASE`) |
| OBL-003 | `not-applicable` | SHA de base historica, anterior ao bootstrap; nao e novo requisito a entregar. |
| OBL-004 | `not-applicable` | Registro historico de arquivos ausentes antes do bootstrap da PR 1347. |
| OBL-005 | `pending` | Exige nova leitura GitHub autenticada das protecoes de develop e main. (`REQ-M1-RULESETS`) |
| OBL-006 | `covered` | O produtor exige revisao e o ensaio 44621447082 rejeitou certificado ausente; cobertura apenas de bloqueio, nao de emissao positiva. (`REQ-M1-FAILCLOSED`) |
| OBL-007 | `not-applicable` | Referencia contextual a issues relacionadas; nao constitui criterio tecnico autonomo. |
| OBL-008 | `covered` | Pin e mirror de fontes oficiais verificados por teste positivo e mutacoes negativas. (`REQ-M1-INTEGRITY`) |
| OBL-009 | `pending` | Falta certificado real e validacao main/release; 26 shards agora instrumentados. (`REQ-M1-HANDOFF`) |
| OBL-010 | `pending` | Coletor neutro instalado, mas pacote nao foi produzido a partir de certificado positivo. (`REQ-M1-PACKET`) |
| OBL-011 | `pending` | Faltam cenarios reais de API e positivo end-to-end em sessao independente. (`REQ-M1-ADVERSARIAL`) |
| OBL-012 | `pending` | Guia ja presente; falta sessao auditora real, referencia verificavel e comprovacao completa. (`REQ-M1-REVIEW-DOC`) |
| OBL-013 | `covered` | Preflight bloqueia habilitacao prematura e preserva Agent-first gate; readback das protecoes requer verificacao final. (`REQ-M1-PROTECTIONS`) |
| OBL-014 | `pending` | Versoes identicas e politica enabled em develop/main nao instaladas ou autorizadas. (`REQ-M2-INSTALL`) |
| OBL-015 | `pending` | Ausente certificado positivo, comentario de outra sessao e check de revisao success. (`REQ-M2-POSITIVE`) |
| OBL-016 | `pending` | Ausentes negativos reais de revogacao, mudancas de issue/base/head e permissao. (`REQ-M2-NEGATIVE`) |
| OBL-017 | `pending` | Required check adicional depende de provas e autorizacao administrativa explicita. (`REQ-M2-ADMIN`) |
| OBL-018 | `pending` | Pos-migracao e rollback ainda nao podem ser ensaiados operacionalmente. (`REQ-M2-ROLLBACK`) |
| OBL-019 | `pending` | Plano retrospectivo detalhado no documento; procedimento formal ainda nao aprovado. (`REQ-M2-RETROSPECTIVE`) |
| OBL-020 | `pending` | Concluir issue exige M1/M2 comprovados, nao apenas CI verde. (`REQ-GOV-COMPLETION`) |
| OBL-021 | `not-applicable` | Inventario historico de CI da PR 1347, nao resultado do HEAD atual. |
| OBL-022 | `not-applicable` | Controle negativo historico sem certificado; nao demonstra sucesso positivo. |
| OBL-023 | `covered` | Material confiavel e lock oficial conferidos no mesmo conjunto de provas de integridade. (`REQ-M1-INTEGRITY`) |
| OBL-024 | `covered` | Rulesets consultados com required Agent-first gate; sem ativacao implicita do verificador. (`REQ-M1-PROTECTIONS`) |
| OBL-025 | `not-applicable` | Resumo historico de checkboxes M1 da issue; nao exige nova alteracao. |
| OBL-026 | `not-applicable` | Registro historico de issue mantida aberta e ausencia de aprovacao operacional. |

## Matriz de testes com mapeamento revisável

Cada ID abaixo corresponde a um teste concreto, positivo, negativo ou regressão; o certificador consulta o JUnit exact-HEAD e rejeita casos ausentes, falhos ou `skipped`. A existência desta matriz **não** concede aprovação.

| Requisito | Positivo | Negativo | Regressão |
|---|---|---|
| `REQ-M1-BASE` | `test_valid_preflight_without_approval` | `test_collector_base_must_remain_develop` | `test_collector_requires_explicit_opt_in_label` |
| `REQ-M1-FAILCLOSED` | `test_valid_preflight_without_approval` | `test_collector_must_inspect_reviewed_closure` | `test_collector_must_fail_closed` |
| `REQ-M1-INTEGRITY` | `test_pinned_official_mirror_is_complete` | `test_official_mirror_rejects_hash_mismatch` | `test_official_mirror_rejects_missing_validator` |
| `REQ-M1-PROTECTIONS` | `test_valid_preflight_without_approval` | `test_required_check_is_not_implicitly_enabled` | `test_activation_is_blocked` |

## Relatórios e controles ainda exigidos

O perfil é `critical`, pois a falha do contrato pode conceder aprovação incorreta, e `audit_history=previous-rejection` pelos achados A-001/A-002/A-003. O produtor oficial precisa validar, com SHA e revisão real, `reviewed-closure.json`, `requirement-attack-matrix.json`, `risk-saturation.json`, `inherited-controls.json`, `codebase-grounding.json`, `audit-remediation.json`, `audit-source-result.json`, `learning-closure.json`, `audit-escape-closure.json`, `previous-audit-escape-closure.json`, além de `pass_c`, fontes, inventário, binding e hashes. O modo incompleto mantém relatórios ausentes visíveis no artefato da CI, não os fabrica.

## Cenários reais M2 e retrospectiva #1298

- Instalar a mesma versão de fonte e política revisada nas bases protegidas `develop` e `main`, mantendo a política desabilitada até a prova positiva/negativa e autorização de implantação.
- Obter certificado positivo no SHA real de PR aberta; em conversa auditora **efetivamente separada**, produzir `SOLVERIT_SESSION_REVIEW_V1` com referência real, comentário autenticado e check verde. Isso não equivale a auditoria de terceiro.
- Exercitar revogação e edição de comentário, alteração de issue/HEAD/base, controles e permissões ausentes, duas PRs com mesmo HEAD, workflow não confiável, e comprovar bloqueio em cada cenário antes de ativar required check.
- Para [#1298](https://github.com/crgasparoto-br/controle_calorias/issues/1298), já mergeada na #1328, não inventar check retroativo: revalidar objetos Git, testes e origem contra o material histórico, pedir revisão separada atual e decisão explícita de governança. Sem procedimento retrospectivo compatível, manter #1298 aberta.
- Read-back obrigatório antes/depois de mudanças em [develop ruleset #18391133](https://github.com/crgasparoto-br/controle_calorias/rules/18391133) e [main ruleset #18391304](https://github.com/crgasparoto-br/controle_calorias/rules/18391304). Preservar `Agent-first gate`, atualização estrita, PR obrigatória e proibições de deleção/force-push.

**Proibição:** nenhum item M1/M2 pendente será marcado como feito por esta coleta; a PR não altera rulesets, não faz merge, não emite recibo de sessão, não fecha #1345/#1298, e o dossiê está conscientemente sem `artifact_sha256`.

## Remediação técnica A-004 (sem certificação)

O conversor `scripts/wrap-node-junit.py` rejeita qualquer atributo raiz
`tests`, `failures`, `errors` ou `skipped` inválido ou divergente dos
`testcase` realmente observados, antes de gravar o JUnit normalizado. Foram
acrescentados controles de contagem válida, discrepâncias nos quatro atributos,
metadados malformados e rejeição pela CLI sem artefato de saída. A ausência de
atributos de contagem na saída real do `node:test` continua aceita, desde que
os eventos sejam legítimos.

Esta correção é **validação interna** do coletor, não fechamento semântico.
A matriz e os relatórios ainda `pending` permanecem abertos até que um novo
run exact-SHA, a revisão do dossiê e a certificação oficial os comprovem.
