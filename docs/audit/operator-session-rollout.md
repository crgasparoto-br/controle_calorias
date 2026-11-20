# Operador unico: plano de instalacao do pipeline de certificacao

**Issue:** [#1345](https://github.com/crgasparoto-br/controle_calorias/issues/1345)  
**Base inicial:** `develop@838ed0a466873a059f335a808947082b7818ff0e`  
**Skill oficial fixada:** `crgasparoto-br/skill@71217ab40be73f64180f253816d7b5214cb23100`  
**Garantia escolhida:** `operator-attested-session-review`, nunca identidade humana independente.

## M1: preparacao segura (esta PR)

O workflow `Operator session certification preflight` executa testes adversariais e valida,
em checkout sem credenciais e com token read-only, o contrato local de instalacao.
O manifesto `.github/operator-session-integration.json` identifica a versao oficial
imutavel e lista TODOS os prerequisitos. A politica local
`.github/session-review-policy.json` permanece `mode=disabled` para impedir ativacao
autorizada pelo proprio candidato. Nenhum job cria Check Run de aprovacao.

### Verificador de sessao e pacote neutro instalados em modo bloqueado

A PR traz copia byte a byte de 15 fontes criticas da Skill oficial,
registradas por Git blob SHA no manifesto `.github/operator-session-tooling-lock.json`.
O codigo executado no runner vem do repositorio Skill no commit fixado;
nao e executado codigo da PR com `checks: write`. O workflow
`.github/workflows/session-review.yml` so executa o verificador se a
variavel de repositório `SOLVERIT_SESSION_REVIEW_ENABLED` for `true`;
ela nao deve ser ativada ate os ensaios M2. O workflow de pacote neutro
so roda na default branch confiavel, em eventos de certificado ou pedido
`/solverit-audit-packet`, e nao concede aprovacao.

O verificador autentica a fonte das copias criticas contra a **base SHA da PR**.
A insercao nesta PR so e bootstrap, pois as copias ainda nao estao na base
protegida: nenhum check valido pode ser reivindicado antes de promover essa
versao para `develop`, depois para `main`, com hashes byte a byte iguais.
O parecer de sessao ainda deve ser feito fora da conversa implementadora.

### Checks tecnicos oficiais (sem enfraquecer a CI)

Os checks `Structure and tests` e `Offline authorization tests` sao
executados em PRs reais a partir das fontes esperadas pelo autenticador oficial
`.github/workflows/validate.yml` e `.github/workflows/github-audit-mcp.yml`.
Executam comandos de build/TypeScript/docs/arquitetura e suites reais de
autorizacao, no commit exato da PR, com permissoes read-only.
**Sao checks adicionais**; o `Agent-first gate` segue sendo obrigatorio.
A adocao dos nomes da Skill nao equivale a revisao independente.

### Coleta e publicacao do handoff (piloto somente)

A integracao fixa o produtor oficial
`.github/workflows/handoff-evidence.yml` no commit da Skill indicado
acima. Por enquanto, somente PRs rotuladas `solverit-certified-handoff`
executam a coleta. O produtor executa primeiro o `pytest` dos testes de governanca e do conversor
Node, preservando seu XML como `junit-shards/shard-25.xml`. Depois executa
`scripts/collect-solverit-certification-tests.sh` com 24 shards Vitest
(concorrencia 2) e com o `node:test` real, convertido para o
`junit-shards/shard-26.xml`. O agregador combina **26 shards reais**
em um unico JUnit factual, indexado pelo produtor oficial, e usa
`produce_actions_handoff_evidence.py` com certificador separado. A coleta
recusa shard ausente, IDs repetidos entre shards, contagens inconsistentes,
resultados falhos, suites vazias com contagens falsas, casos fora da hierarquia
JUnit e qualquer shard sem teste nao-skipped efetivamente executado.
O conversor Node tambem rejeita contagens `tests`, `failures`, `errors` e
`skipped` declaradas na raiz que sejam invalidas ou contradigam os casos;
XML sem essas contagens continua compativel com o reporter real. Os casos
skipped permanecem skipped em shards com execucao real. A saida recusa symlinks
de arquivo/diretorio, inclusive destino inexistente e trocas concorrentes.
Casos parametrizados com mesmo nome preservam cada
execucao com ID reprodutivel e nome original. O `Agent-first gate` exercita
testes positivos e adversariais desse consolidador. O preflight da Skill
(40 testes locais e 300 oficiais) continua tambem no workflow dedicado.
**O JUnit tecnico nao substitui o dossie semantico:** o mapeamento dos
casos a requisitos permanece `UNKNOWN` ate uma closure revisada.
**Sem uma closure semantica revisada, o certificador deve falhar**, e o
workflow nao pode ser considerado pronto nem requerido pelos rulesets.

O publicador `.github/workflows/publish-certified-handoff.yml` foi preparado
para executar somente a partir de `workflow_run` na default branch confiavel,
apos sucesso autenticado do produtor. Usa `reusable-publish-handoff.yml`
fixado por commit da Skill; o codigo da PR nao e executado com
`contents: write`. Este wrapper permanecera inerte enquanto nao for
promovido de modo revisado para `main`; sua presenca na branch candidata
**nao** comprova instalacao na default branch nem permissao para publicar.

Os controles de qualidade executam as suites oficiais fixadas no mesmo commit:
`test_session_review`, `test_session_review_dossier`,
`test_session_review_runner`, `test_session_review_workflows`,
`test_session_certificate_event` e `test_plan_session_ruleset_m2`.
O comando local de validacao e `python -m unittest discover -s tests -p
'test_operator_session_preflight.py' -v`; a fonte e o oraculo official
continuam separados do candidato.

**Limite:** esta etapa nao gera `Verify session review (exact SHA)`, nao certifica a
implementacao, nao satisfaz auditoria independente nem permite encerrar a #1298.
CI verde neste workflow demonstra somente preflight estrutural, nao um review.

### Prerequisitos antes de M2

1. Implantar e testar no consumidor scripts/schemas/workflows oficiais da Skill, a partir
   do pin acima, com inventario de dependencias e fonte confiavel. O workflow da Skill
   nao e um simples script isolado: requer parsers de especificacao, validador de
   certificado e leitor de fatos GitHub. Nao copiar apenas o YAML.
2. Instrumentar a CI existente para gerar **handoff semantico certificado** no HEAD
   material com JUnit real contendo positivo, negativo e regressao para cada obrigacao
   pertinente. O `Agent-first gate` isolado nao produz esses artefatos.
3. Coletar pacote neutro com issue canonica, base/head/preview, blobs integrais,
   hashes, diff reconstruido, certificado e testes realmente executados. Nenhuma
   conclusao do implementador e aceita como evidencia propria.
4. Instalar a mesma politica e mesmo codigo confiavel em `develop` e `main`,
   confirmando identidades de arquivos por hashes e ref protegido.
5. Em conversa **realmente separada** da implementacao, produzir analise independente
   das evidencias e registrar comentario imutavel iniciado por
   `SOLVERIT_SESSION_REVIEW_V1`, seguido de JSON conforme
   [procedimento oficial](https://github.com/crgasparoto-br/skill/blob/develop/docs/WEB_INDEPENDENT_AUDIT.md).
   Em perda da conversa de implementacao, usar apenas procedencia GitHub
   autenticada explicitamente autorizada; nao inventar URL de conversa.
6. Em PR aberta de ensaio, provar sucesso exato `Verify session review (exact SHA)`;
   testar negativos reais: falta de review, sessoes iguais/falsas, autor nao autorizado,
   comentario alterado ou apagado, base/head/issue alterados, CI/handoff sem prova,
   dois PRs no mesmo HEAD, revogacao e workflow nao confiavel.
7. Somente depois desses ensaios e da leitura autenticada das protecoes, considerar
   exigir o check novo nos rulesets de `develop` e `main`. Preservar sempre
   `Agent-first gate`, PR obrigatoria, strict checks, protecao de delecao e force-push.

## Autoridade e implantacao

A revisao em sessao separada e uma declaracao do operador autenticada pelo GitHub;
nao prova pessoa diferente. O modo `single-operator-separate-context` com
Ed25519 e um **contrato separado**, nao equivale ao escolhido aqui.

A M1 nao modifica rulesets nem mergeia branches. Habilitar a politica e instalar
o publicador confiavel pertence a M2, somente apos evidencia verificavel de todos
os preflight/adversarial gates. Modificar a propria branch candidata nao habilita
o gate. Configuracoes presentes em `main` e `develop` devem ser iguais byte a byte.

### Retrospectiva da #1298

O contrato oficial de sessao requer PR **aberta** e certificado do material exato.
A #1328 ja foi mergeada. Nao fabricar parecer antigo ou check retroativo.
Estabelecer um procedimento de retrospectiva com objeto Git autenticado e
aprovacao explicita de governanca, ou manter a #1298 aberta.

## Rollback

Antes de ativar o required check novo, registrar via GitHub API o JSON integral,
IDs, enforcement e required check de ambos os rulesets (#18391133 e #18391304).
Se testes reais demonstrarem falha, manter politica desativada; se falha ocorrer
apos adocao, bloquear merges, revogar o parecer ativo e restaurar apenas a regra
administrativa previamente comprovada. Nunca remover `Agent-first gate`.

### Ensaios reais do bootstrap (19/11/2026)

- **Controle negativo de certificacao:** PR #1347 com opt-in temporario
  `solverit-certified-handoff` produziu o
  [run #44548972444](https://github.com/crgasparoto-br/controle_calorias/actions/runs/44548972444).
  O job tecnico executou, mas o certificador remoto **falhou fechado** com
  `certification-inputs.json absent: semantic closures have not been supplied`.
  O label foi retirado apos o ensaio, para nao induzir bloqueio de PRs sem dossie.
- **Compatibilidade da arquitetura:** no primeiro run do novo `Structure and tests`,
  `pnpm architecture:check` nao localizou o SHA do baseline historico no checkout
  raso. Corrigido com `fetch-depth: 0` no job exato, preservando a verificacao.
  Nao foi dispensado o gate, reduzido teste ou forjado SHA.
- **Escopo da evidencia:** o resultado negativo **nao** e ensaio positivo de
  handoff, pacote neutro ou parecer independente. Esses itens continuam em M2.
