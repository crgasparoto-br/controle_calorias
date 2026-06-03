# Privacidade e LGPD

Este projeto processa dados de saúde e hábitos alimentares. Trate toda mudança em IA, WhatsApp, mídia, logs, analytics, exportação e exclusão como mudança sensível.

## Dados pessoais e sensíveis

| Categoria | Exemplos |
|---|---|
| Identidade | Nome, e-mail, `openId`, telefone WhatsApp |
| Saúde/nutrição | Peso, objetivo, restrições, refeições, macros, hidratação, exercícios |
| Conteúdo bruto | Texto de refeição, transcrição, imagem, áudio |
| Integrações externas | Tokens OAuth, identificadores externos, atividades importadas do Strava, distância, duração, elevação, frequência cardíaca, cadência e potência |
| IA | Prompt, reasoning, confidence, inferências e logs |
| Operação | Tokens, IDs de canal, URLs de mídia e detalhes técnicos |

## Princípios

- Minimização: persistir apenas o necessário para o produto.
- Finalidade: documentar por que cada novo dado sensível é necessário.
- Transparência: exportação deve ser compreensível para o usuário.
- Segurança: logs e analytics devem ser sanitizados.
- Retenção: dados brutos de IA, mídia e integrações externas devem ter retenção intencional, não acidental.

## Regras práticas

- Não logar `sourceText`, `transcript`, `reasoning`, token, telefone completo, URL assinada ou payload bruto de atividade externa.
- Não enviar dados de saúde identificáveis para analytics.
- Usar `safeLogDetail` ou helper equivalente para detalhes operacionais.
- Ao adicionar integração externa, documentar dados enviados, motivo e comportamento de exclusão.
- Tokens do Strava devem permanecer criptografados em `appSecrets`; logs de sincronização automática devem conter apenas contadores, status e mensagens sanitizadas.
- Atividades do Strava são importadas para exercícios para manter o diário do usuário atualizado sem sincronização manual.
- Métricas detalhadas do Strava, incluindo frequência cardíaca, cadência, potência, equipamento, visibilidade e contadores sociais, devem ser exibidas apenas para o usuário autenticado e não devem aparecer em logs ou analytics.
- O escopo `activity:read_all` deve ser usado apenas para permitir importação de atividades privadas ou Only Me quando o usuário reconectar e conceder esse acesso.
- Ao adicionar tabela/campo sensível, atualizar `docs/generated/db-schema.md`.

## Checklist para PRs sensíveis

- [ ] O dado coletado é necessário?
- [ ] Existe base clara no produto para uso do dado?
- [ ] Exportação e exclusão continuam coerentes?
- [ ] Logs e analytics foram sanitizados?
- [ ] Documentação foi atualizada?
