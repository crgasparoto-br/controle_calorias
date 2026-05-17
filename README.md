# Controle de Calorias

Controle de Calorias é uma plataforma de nutrição com registro multimodal de refeições, revisão antes de persistência, acompanhamento de metas e operação por web e WhatsApp. O projeto segue como um monólito React + Express + tRPC + Drizzle, com a camada principal de IA isolada no backend.

## O que o produto faz hoje

| Domínio | Situação atual |
|---|---|
| Registro alimentar | Entrada por texto, imagem, áudio e cadastro manual |
| Inferência nutricional | Núcleo compartilhado entre web e WhatsApp, validado com Zod |
| Confirmação | Persistência apenas após revisão/fluxo equivalente |
| WhatsApp | Entrada e resposta pelo número oficial configurado |
| Relatórios | Dashboard diário, visão semanal e detalhamento por refeição |
| Operação administrativa | Status do canal e atualização segura do token do WhatsApp |

## Fluxo de refeição

1. O usuário envia texto, imagem ou áudio.
2. O backend monta um rascunho revisável com itens, porções e macros.
3. O usuário revisa ou confirma pelo fluxo conversacional.
4. A refeição confirmada alimenta dashboard, relatórios e hábitos.

A confirmação de refeição não depende de chamada externa. Falhas de transcrição, inferência ou imagem auxiliar são tratadas de forma controlada para não corromper dados nem bloquear a confirmação local.

## Estado da migração OpenAI

A migração segue o plano em `docs/exec-plans/active/migrate-ai-to-openai.md`.

Situação atual:

- Transcrição de áudio já usa o provider OpenAI isolado no backend.
- Inferência nutricional de texto e imagem já usa o provider OpenAI com saída estruturada e validação Zod.
- Geração visual auxiliar foi movida para helper OpenAI opcional. Se falhar ou não estiver configurada, a análise da refeição continua normalmente.
- O legado Forge permanece apenas no subsistema de sugestões educativas do assistente alimentar. Essa dependência remanescente foi mantida e documentada porque não faz parte do fluxo principal de registro de refeição.

## Variáveis de ambiente

### Backend OpenAI

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` opcional
- `OPENAI_MODEL` para inferência nutricional estruturada
- `OPENAI_TRANSCRIPTION_MODEL` para áudio
- `OPENAI_IMAGE_MODEL` para visual auxiliar opcional

Regras importantes:

- `OPENAI_API_KEY` deve existir apenas no backend.
- Não exponha `OPENAI_*` via `VITE_*`.
- Não adicione `OPENAI_API_KEY` na Vercel se ela for usada apenas para frontend estático. A chave deve ficar apenas no runtime backend responsável pelas chamadas ao provider.

### Variáveis legadas remanescentes

- `BUILT_IN_FORGE_API_KEY`
- `BUILT_IN_FORGE_API_URL`

Essas variáveis continuam necessárias somente enquanto o assistente alimentar educativo ainda usar o provider legado. Elas não devem voltar a ser usadas por transcrição, inferência nutricional nem confirmação de refeição.

### WhatsApp

- `WHATSAPP_PHONE_NUMBER`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`

## Qualidade e gates

Comandos esperados para mudanças neste repositório:

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

## Rollout

O checklist operacional da Fase 7 fica em `docs/runbooks/openai-rollout-checklist.md`.

Resumo do rollout:

- configurar OpenAI apenas no backend do Render;
- manter frontend/Vercel sem `OPENAI_API_KEY`;
- validar web e WhatsApp com smoke tests;
- monitorar apenas erros sanitizados, sem conteúdo cru em logs.
