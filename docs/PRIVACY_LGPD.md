# Privacidade e LGPD

Este projeto processa dados de saúde e hábitos alimentares. Trate toda mudança em IA, WhatsApp, mídia, logs, analytics, exportação e exclusão como mudança sensível.

## Dados pessoais e sensíveis

| Categoria | Exemplos |
|---|---|
| Identidade | Nome, e-mail, `openId`, telefone WhatsApp |
| Saúde/nutrição | Peso, objetivo, restrições, refeições, macros, hidratação, exercícios |
| Conteúdo bruto | Texto de refeição, transcrição, imagem, áudio |
| IA | Prompt, reasoning, confidence, inferências e logs |
| Operação | Tokens, IDs de canal, URLs de mídia e detalhes técnicos |

## Princípios

- Minimização: persistir apenas o necessário para o produto.
- Finalidade: documentar por que cada novo dado sensível é necessário.
- Transparência: exportação deve ser compreensível para o usuário.
- Segurança: logs e analytics devem ser sanitizados.
- Retenção: dados brutos de IA e mídia devem ter retenção intencional, não acidental.

## Regras práticas

- Não logar `sourceText`, `transcript`, `reasoning`, token, telefone completo ou URL assinada.
- Não enviar dados de saúde identificáveis para analytics.
- Usar `safeLogDetail` ou helper equivalente para detalhes operacionais.
- Ao adicionar integração externa, documentar dados enviados, motivo e comportamento de exclusão.
- Ao adicionar tabela/campo sensível, atualizar `docs/generated/db-schema.md`.

## Checklist para PRs sensíveis

- [ ] O dado coletado é necessário?
- [ ] Existe base clara no produto para uso do dado?
- [ ] Exportação e exclusão continuam coerentes?
- [ ] Logs e analytics foram sanitizados?
- [ ] Documentação foi atualizada?
