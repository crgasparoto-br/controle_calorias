# Inventario da camada atual de IA - Fase 1

## Objetivo

Registrar os pontos atuais onde o produto depende de IA interna, Forge, transcricao, geracao de imagem, analise de foto e processamento de rascunho antes da troca de provider.

## Resumo executivo

- O provider atual de texto e visao esta centralizado em `server/_core/llm.ts`.
- O provider atual de transcricao esta centralizado em `server/_core/voiceTranscription.ts`.
- A geracao de imagem auxiliar existe em `server/_core/imageGeneration.ts`.
- O processamento principal de rascunho de refeicao acontece em `server/nutritionEngine.ts` e e acionado por `server/modules/meals/service.ts`.
- O fluxo WhatsApp reaproveita o mesmo processamento de rascunho via `server/modules/whatsapp/service.ts` e `server/whatsappWebhook.ts`.
- A analise de foto de refeicao em `server/modules/photoAnalysis/service.ts` ainda e simulada localmente e nao chama provider externo.
- A confirmacao de refeicao continua local, passando por `server/modules/meals/service.ts` e pelas funcoes de persistencia em `server/db.ts`, sem dependencia de provider externo no momento da confirmacao.

## Pontos mapeados

| Area | Arquivos principais | Dependencia atual | Comportamento atual | Observacoes para migracao |
|---|---|---|---|---|
| Configuracao do provider | `server/_core/env.ts` | `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Mantem segredos apenas no backend | Nao expor no frontend |
| LLM texto e visao | `server/_core/llm.ts` | Forge `v1/chat/completions` | Envia mensagens estruturadas, schema JSON e resumo sanitizado de auditoria | Migrar por interface, nao por uso direto em dominio |
| Processamento de rascunho | `server/nutritionEngine.ts` | `invokeLLM` + fallback heuristico | Texto, transcricao e imagem viram itens nutricionais confirmaveis | Ja existe fallback quando a IA falha |
| Transcricao | `server/_core/voiceTranscription.ts` | Forge `v1/audio/transcriptions` | Baixa audio, valida tamanho e chama Whisper compativel | Retorno atual aceita erro controlado sem throw obrigatorio |
| Rascunho de refeicao | `server/modules/meals/service.ts` | `transcribeAudio`, `processMealInput`, `storagePut` | Salva midia, transcreve audio, cria rascunho pendente e registra warning sanitizado | Confirmacao nao chama provider externo |
| WhatsApp inbound | `server/modules/whatsapp/service.ts`, `server/whatsappWebhook.ts` | Reuso de `processMealDraft` | Texto, imagem e audio convergem para o mesmo nucleo | Fluxo deve continuar compartilhando o mesmo provider |
| Foto de refeicao | `server/modules/photoAnalysis/service.ts` | Mock local | Sugestoes simuladas, revisao humana e confirmacao manual | Nao depende de provider externo hoje |
| Assistente alimentar | `server/modules/assistant/service.ts` | `invokeLLM` com fallback local | Gera sugestao educativa e cai para fallback ao falhar | Ja sanitiza pedido e detalhe de erro |
| Geracao de imagem auxiliar | `server/_core/imageGeneration.ts` | Forge `images.v1.ImageService/GenerateImage` | Gera imagem e salva em storage | Recurso auxiliar, nao deve bloquear registro ou confirmacao |
| Persistencia e logs | `server/db.ts`, `server/privacy.ts` | Banco e helpers de redacao | Guarda rascunho, historico e logs de inferencia com sanitizacao | Nao logar `sourceText`, `transcript`, URLs ou tokens |

## Cobertura de caracterizacao existente ou adicionada nesta fase

| Fluxo | Cobertura |
|---|---|
| Rascunho por texto | `server/nutritionEngine.test.ts` e `server/modules/meals/service.test.ts` |
| Imagem mockada | `server/modules/meals/service.test.ts` e `server/whatsappWebhook.test.ts` |
| Audio/transcricao mockada | `server/modules/meals/service.test.ts` e `server/whatsappWebhook.test.ts` |
| Erro controlado de IA | `server/nutritionEngine.test.ts` e `server/modules/meals/service.test.ts` |
| Confirmacao sem provider externo | `server/modules/meals/service.test.ts` e `server/nutritionRouter.test.ts` |

## Invariantes preservados nesta fase

- Nao instalar OpenAI.
- Nao trocar provider.
- Nao alterar autenticacao.
- Nao alterar comportamento do produto.
- Nao expor credenciais.
- Nao registrar dados sensiveis em logs, fixtures ou snapshots.

## Riscos residuais

- `server/_core/llm.ts` e `server/_core/voiceTranscription.ts` ainda falam diretamente com Forge e precisarao de uma interface de provider na proxima fase.
- `server/_core/imageGeneration.ts` continua fora do fluxo critico de refeicao, mas tambem precisara de isolamento antes da remocao do legado.
- Parte relevante da robustez atual depende de fallback heuristico e de mocks locais; a migracao precisara preservar esses contratos antes da troca efetiva.
