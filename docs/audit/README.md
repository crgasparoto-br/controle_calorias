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
