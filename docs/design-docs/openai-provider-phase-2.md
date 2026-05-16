# Design técnico: provider OpenAI isolado

## Objetivo

Introduzir o SDK oficial da OpenAI apenas no backend, por trás de uma interface interna de provider, sem trocar ainda os fluxos de transcrição, inferência nutricional ou geração visual em produção.

## Decisões desta fase

- O SDK oficial `openai` existe apenas no backend.
- `server/_core/openaiClient.ts` centraliza a criação do cliente real.
- `server/_core/aiProvider.ts` define a interface interna e a factory do provider.
- O provider pode ser mockado em testes sem exigir `OPENAI_API_KEY`.
- A ausência de `OPENAI_API_KEY` só gera erro quando o cliente real é criado.
- O backend segue compatível com o legado até as próximas fases da migração.

## Contrato interno

```text
serviço de domínio -> camada interna de provider -> cliente real do provider
```

Os serviços de domínio não devem depender diretamente do SDK oficial. Nesta fase, o objetivo é preparar a fundação da migração sem misturar autenticação, sem expor segredo no frontend e sem exigir credenciais reais para build ou testes com mocks.

## Ambiente

Variáveis novas de backend:

- `AI_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

Regras:

- não criar equivalente `VITE_*` para credenciais OpenAI;
- manter `AI_PROVIDER=forge` até as próximas fases concluírem a migração funcional;
- usar `OPENAI_BASE_URL` apenas quando houver necessidade operacional explícita;
- tratar qualquer erro do provider com mensagens claras e sem vazamento de segredo.
