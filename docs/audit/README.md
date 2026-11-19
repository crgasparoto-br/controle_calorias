# Auditoria independente GitHub-native

Fonte canônica: [github-native-contract.json](./github-native-contract.json).
Contrato consumidor: `crgasparoto-br/skill/auditar-issue/references/native-github-audit-contract.md` na versão confiável da skill.

## Regra de confiança (obrigatória)

O auditor deve ler este contrato **somente no SHA imutável da base da PR** (`pull_request.base.sha`), nunca a partir do head da PR auditada. A existência do contrato no próprio candidato não o autoriza a dispensar handoff. O bootstrap que adiciona este contrato continua sujeito ao transporte de auditoria anterior; esta alteração não constitui sua própria aprovação. Um rebase ou atualização de base invalida a evidência anterior e exige novo preflight.

No preflight, o auditor materializa o contrato da base e prova sua identidade por SHA-256 dos bytes ou Git blob SHA, com `path`, `observed_at_sha`, `canonical`, `audit_mode`, `legacy_handoff_policy`, `github_native_identity`, `exact_sha_evidence`, `independent_review` e `remote_ci_evidence`. O classificador da skill decide o transporte. Se a base não contiver contrato completo e confiável, manter `certified-handoff` e não usar o contrato do head.

## Evidências obrigatórias

1. Identidade imutável: repositório, issue, PR, base SHA, head SHA, referências e merge preview.
2. Diff da PR, perfil de risco, política aplicável e checks requeridos em estado terminal verde no SHA exato (incluindo `Agent-first gate`).
3. Manifesto exact-head e alcance real dos testes, diferenciando testes declarados, alcançados e aprovados.
4. Auditoria **independente** em contexto separado do implementador; CI verde não substitui essa revisão.
5. Achados anteriores, escopo afetado e riscos de segurança, segredos e persistência, quando aplicáveis.

Falta de evidência obrigatória é `UNKNOWN`/bloqueio, nunca aprovação tácita. Ausência de `.audit/entregar-issue` não é falha **somente depois** de o contrato GitHub-native ter sido provado na base e aceito pelo classificador.

## CI e migração segura

O workflow mantém o check obrigatório `Agent-first gate`, executa o teste determinístico `node scripts/check-github-native-audit-contract.mjs` e preserva FAST/STANDARD/CRITICAL, preview de merge, exact-head, testes de produto e artefatos. O teste verifica a configuração e falha em cenários de contrato inválido. Não executa skill nem chama IA no GitHub Actions.

Sequência segura: (1) auditar este bootstrap com o contrato vigente; (2) fazer merge autorizado desta PR em `develop`; (3) atualizar a base de PRs de migração já abertas, como #1318, para conter o contrato confiável; (4) executar novos checks exact-head e auditoria independente GitHub-native; (5) retirar transporte legado apenas depois de verificar consumidores externos. Não remover `.delivery-v2/` como consequência automática da adoção.

O ruleset GitHub deve exigir `Agent-first gate` em `develop` e `main`. A efetividade do ruleset deve ser verificada pela API GitHub, não inferida deste documento. Nenhuma etapa faz merge automático.

## Revisão de operador único — implantação controlada (#1345)

**Decisão:** `operator-attested-session-review`: o operador pode implementar e
revisar em conversas reais diferentes. A atestação prova vínculos de evidência
GitHub e declara a separação; **não prova duas pessoas nem equivale a um
parecer humano independente**. Não confundir com a modalidade Ed25519
`single-operator-separate-context`.

### M1 — pipeline de evidências instalado, enforcement desligado

- Fonte executável canônica: `crgasparoto-br/skill` no commit imutável
  `71217ab40be73f64180f253816d7b5214cb23100`, pelo reusable workflow
  `.github/workflows/reusable-handoff.yml`. Mudança de SHA exige revisão e
  recertificação da integração. Nenhum token/secret de IA é utilizado.
- `.github/workflows/handoff-evidence.yml` executa **somente** em PR aberta
  não-draft contra `develop` que declare a linha exata
  `SolverIT-Certification-Pilot: true` no corpo da PR. O gatilho executa
  código candidato apenas com `contents/issues/pull-requests: read`.
- O coletor obtém o objeto de PR, issue, SHA de base/HEAD e merge preview pela
  API autenticada, roda a suíte de 24 shards com JUnit factual e publica
  `handoff-evidence-<PR>-<HEAD>` com logs, índice JUnit e diagnóstico.
- `scripts/merge-vitest-junit.py` recusa shard ausente, teste duplicado,
  resultado falho ou XML inválido. Teste skipped continua skipped; nenhum
  resultado é mapeado automaticamente a critério de aceite.
- `produce_actions_handoff_evidence.py` só produz certificado semântico quando
  existe dossiê revisado e completo em `.github/handoff-evidence/issue-<N>/`,
  com controles `positive/negative/regression` realmente executados.
  `awaiting-reviewed-evidence` deixa a coleta factual disponível, porém a
  **certificação falha de modo fechado**. O workflow não libera PR ou issue.
- `.github/session-review-policy.json` é instalada com `mode=disabled` e
  allowlist vazia. Não há emissão de check de aprovação por sessão neste M1.
  `Agent-first gate` continua sendo o único check exigido nos rulesets atuais.

### M2 — condições obrigatórias antes da ativação

1. Auditar a instalação sobre o SHA exato e promover de modo sequencial a
   implementação confiável para `develop` e `main` (default); os bytes da
   política/verificador devem coincidir em ambas as bases.
2. Adaptar/instalar o verificador oficial `verify_session_review.py` com
   autenticação dos checks **deste** repositório (`Agent-first gate`, certificado
   exato), sem reutilizar os nomes de checks do repo `skill` por conveniência.
   Instalar também o coletor neutro e validar identidades/hashes de artefatos.
3. Produzir handoff semântico real de PR aberta e **parecer em outra conversa**;
   registrar o comentário imutável `SOLVERIT_SESSION_REVIEW_V1` com referência
   autêntica da sessão, matriz de requisitos e três controles JUnit por requisito.
4. Comprovar `Verify session review (exact SHA)` verde por prova real positiva,
   e fail-closed por edição/exclusão de comentário, SHA ou issue diferente,
   alteração de base, CI/certificado ausente, usuário não autorizado e duas PRs
   concorrentes no mesmo HEAD.
5. Só após read-back de `develop` **e** `main`, mudança administrativa autorizada
   pode exigir o novo check, **somando-o** a `Agent-first gate`, sem reduzir PR
   obrigatória, checks técnicos ou proibições de force-push/exclusão. Registrar
   rollback ensaiado e snapshot das regras.

**Escopo retrospectivo:** a #1298 já está integrada via PR #1328; não forjar
um check associado a PR antiga nem tratar pré-auditoria como certificação M2.
Manter #1298 e o checkbox A1 da #1297 pendentes até um procedimento de
fechamento retrospectivo expressamente aceito pela política vigente.

Para instruções normativas completas, consulte a
[Skill oficial](https://github.com/crgasparoto-br/skill/blob/develop/docs/WEB_INDEPENDENT_AUDIT.md)
e a [issue #1345](https://github.com/crgasparoto-br/controle_calorias/issues/1345).
