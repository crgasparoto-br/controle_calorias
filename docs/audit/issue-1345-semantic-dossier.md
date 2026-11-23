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
| OBL-009 | `pending` | Falta certificado real e validacao main/release; 27 shards previstos nesta continuação (27º = seis suítes de governança da Skill oficial), ainda sujeitos a nova execução no HEAD. (`REQ-M1-HANDOFF`) |
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

## Leitura autenticada das proteções e da instalação — 20/11/2026

Esta seção é um **read-back técnico**, não um relatório de aprovação, e descreve o estado observado antes do commit documental que a inclui.

- [Ruleset develop #18391133](https://github.com/crgasparoto-br/controle_calorias/rules/18391133): `enforcement=active`, proteção contra `deletion` e `non_fast_forward`, PR obrigatória, `strict_required_status_checks_policy=true` e contexto requerido `Agent-first gate`. Nenhum check de revisão por sessão consta como obrigatório.
- [Ruleset main #18391304](https://github.com/crgasparoto-br/controle_calorias/rules/18391304): mesmas categorias de proteção e check técnico obrigatório. A API retornou `current_user_can_bypass=never` para a identidade consultada, mas `bypass_actors_visibility=UNKNOWN_NO_WRITE_ACCESS`: **não** inferir ausência global de atores de bypass a partir de resposta incompleta.
- `develop` contém `.github/session-review-policy.json` com `mode=disabled` e blob Git `9d2c10998adf0fe35c0733967870f5dd699658ec`; a versão de `.github/workflows/session-review.yml` possui blob `a48ca4e226fe9bf380d6be79e3d23768cfa3a3f4`.
- Consultas aos paths `.github/session-review-policy.json`, `.github/workflows/session-review.yml`, `.github/workflows/prepare-neutral-audit-packet.yml`, `.github/workflows/handoff-evidence.yml` e `.github/operator-session-integration.json` na branch `main` retornaram HTTP 404. Isso **não** demonstra equivalência de versões nem instalação operacional; demonstra a precondição de implantação ainda não satisfeita na leitura.
- A comparação [`main...develop`](https://github.com/crgasparoto-br/controle_calorias/compare/main...develop) retornou `diverged` (1.139 commits à frente e 15 atrás, na direção `main...develop`). Não promover automaticamente uma branch sobre a outra como substituto de uma release auditada.

**Disposição:** a leitura autenticada supre o diagnóstico factual de `OBL-005 / REQ-M1-RULESETS`, mas esse item mantém `pending` no *overlay* semântico até vinculá-lo a controles positivos, negativos e de regressão adequados e revalidar o HEAD. `OBL-014..018` permanecem pendentes; nenhuma política, regra ou branch foi alterada pelo read-back.

## Plano específico e auditável de certificação retrospectiva — #1298

Este registro versiona o [procedimento já publicado na issue #1345](https://github.com/crgasparoto-br/controle_calorias/issues/1345#issuecomment-7023737139). **Registrar o plano não é executar ou aprovar a certificação.** A via normal exige PR aberta e não admite transformar a [PR #1328](https://github.com/crgasparoto-br/controle_calorias/pull/1328), que já foi mergeada, em um evento de revisão atual.

### Âncoras históricas imutáveis

| Objeto | Identidade |
| --- | --- |
| Escopo | [Issue #1298](https://github.com/crgasparoto-br/controle_calorias/issues/1298) e [épica #1297](https://github.com/crgasparoto-br/controle_calorias/issues/1297) |
| PR remediadora já mergeada | [#1328](https://github.com/crgasparoto-br/controle_calorias/pull/1328) |
| Base histórica da #1328 | `68d7186aeca4e442d79fad77e5e2cebd5c6abba0` |
| HEAD material histórico da #1328 | `02d9dbffcf51fa3ac05c1fc138abd76b5b166b8b` |
| Merge commit histórico | `1a6ef153797c3f855fbea54ae068851b634bd152` |
| CI de remediação no HEAD histórico | [Agent-first gate #39587848259](https://github.com/crgasparoto-br/controle_calorias/actions/runs/39587848259) |

### Procedimento proposto (sem autorização de exceção)

1. **Autenticar os objetos de origem.** Em leitura somente GitHub, comparar issue/épica/ADR, PR fechada, base, HEAD e merge commit por bytes/blobs completos, pais e árvores Git. Registrar digests. Uma URL ou narrativa da PR não substitui a leitura.
2. **Reconstruir os cinco critérios de aceite A1 sem alterar escopo.** Validar separadamente versão/schema imutável, origem `text` versus `transcription`, snapshot V1 sem reinferência, pendência versionada com retry/restart e bloqueio de uso produtivo dos contratos V2. Não tratar persistência durável posterior como obrigação A1.
3. **Reexecutar controles discriminantes sem retroagir o relógio.** Para cada critério, associar teste positivo, ataque negativo e regressão, com JUnit real, comando, ambiente, logs, exit code, SHA e digests. Identificar explicitamente `historical-ci` ou `current-replay-of-historical-SHA`; artefatos expirados são indisponíveis, nunca `passed` inferido.
4. **Produzir pacote neutro suplementar e verificar ataques.** Incluir diff reconstituído a partir de blobs, fontes, inventário, identidades e limitações. Testar base/HEAD divergente, artefato adulterado, check sem SHA correspondente, autor não autorizado e ausência de recibo. Não fabricar evento de `pull_request`, check `Verify session review (exact SHA)` histórico ou `certification-inputs.json` retroativo.
5. **Submeter decisão de governança explícita.** A política `operator-attested-session-review` vigente exige PR aberta; qualquer rito retrospectivo precisa de contrato confiável e autorização administrativa anterior à aceitação. Encaminhar pacote à revisão em conversa realmente separada e registrar suas limitações e o alcance do parecer, sem alegar terceiro independente.
6. **Aplicar condição de fechamento.** Manter #1298 aberta e o item A1 da #1297 desmarcado até aprovação formal da política retrospectiva e evidência aceita. Se o contrato não permitir a retroatividade, registrar decisão explícita de não certificar, sem emitir aprovação artificial ou promover entrada V2 em produção.

**Classificação:** o planejamento retrospectivo está documentado; autenticação completa do pacote, testes/replays, decisão administrativa e revisão separada continuam **não executados**. A aprovação M2, o certificado e a conclusão da #1345 continuam bloqueados. Não usar este documento como `reviewed-closure.json` aprovado.

## M1/M2 — decisão explícita de fase com origem canônica (23/11/2026)

Os registros `OBL-014..018` (implantação M2) e `OBL-020` (conclusão global)
foram classificados como `deferred` no overlay, vinculados ao corpo canônico
preservado da [issue #1345](https://github.com/crgasparoto-br/controle_calorias/issues/1345)
por `decision_source_sha256`, `decision_locator`, `target_issue` e
`parent_issue_must_remain_open=true`. São obrigações **pós-handoff** e **não
foram implementadas**. Os checkboxes permanecem desmarcados; a classificação
não reduz escopo, não constitui revisão independente e não autoriza ativação.

A decisão foi verificada localmente com `_verify_deferred_phase` da Skill
oficial, usando o corpo real da issue do artefato técnico exact-SHA
`0ba6c1793` e o `requirement-closure.json` gerado pelo produtor. O estado
`review_state=incomplete` é intencional: M1-02, M1-03 e M1-04, o protocolo
de revisão e os relatórios críticos ainda exigem revisão factual, controles
adequados e certificação positiva antes que seja seguro instalar M2. Os
relatórios obrigatórios ausentes e `artifact_sha256={}` não foram mascarados.

## Extensão técnica da coleta — suítes oficiais em JUnit

A coleta passa a incluir um 27º shard JUnit produzido pela execução das seis suítes de
política/verificador de sessão e regras da Skill no checkout oficial **pinado**.
O primeiro shard Python local, os 24 Vitest e o Node continuam obrigatórios.
O agregador rejeita ausência, falha, duplicação de identidade e contagem inconsistente
de qualquer shard; um preflight externo verde não é substituto de execução no run
de coleta. A cobertura factual dos testes oficiais pode fundamentar os vínculos M1
após revisão semântica, **não** prova sessão separada, certificado, pacote neutro
ou ativação M2. As evidências históricas de 26 shards não valem para este HEAD.
