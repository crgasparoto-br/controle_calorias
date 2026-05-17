# Checklist de rollout OpenAI

Este checklist prepara a ativação em produção após as Fases 5 e 6 da migração.

## Escopo

- transcrição de áudio no provider OpenAI;
- inferência nutricional multimodal no provider OpenAI;
- visual auxiliar opcional no provider OpenAI;
- nenhum uso obrigatório do provider legado no fluxo principal de refeição.

## Ambiente Render

- [ ] Configurar `OPENAI_API_KEY` somente no backend do Render.
- [ ] Configurar `OPENAI_MODEL` com o modelo aprovado para inferência nutricional.
- [ ] Configurar `OPENAI_TRANSCRIPTION_MODEL` para áudio.
- [ ] Configurar `OPENAI_IMAGE_MODEL` apenas se o apoio visual opcional for desejado no ambiente.
- [ ] Manter `OPENAI_BASE_URL` vazio, salvo necessidade explícita de compatibilidade.
- [ ] Confirmar que nenhum segredo OpenAI foi adicionado em código, seed, fixture ou documentação pública.

## Ambiente Vercel

- [ ] Não adicionar `OPENAI_API_KEY` na Vercel.
- [ ] Confirmar que não existe nenhuma variável `VITE_OPENAI_*`.
- [ ] Validar que o frontend consome somente o backend/tRPC e não chama a OpenAI diretamente.

## Dependências legadas

- [ ] Confirmar que `BUILT_IN_FORGE_API_KEY` e `BUILT_IN_FORGE_API_URL` permanecem apenas para o assistente educativo, se esse subsistema continuar ativo.
- [ ] Não reutilizar o provider legado em transcrição, inferência nutricional ou confirmação de refeição.
- [ ] Planejar a remoção futura do assistente legado em uma fase própria, fora deste rollout.

## Smoke tests web

- [ ] Registrar refeição por texto e confirmar.
- [ ] Registrar refeição por imagem e confirmar.
- [ ] Registrar refeição por áudio e confirmar.
- [ ] Validar que falha de imagem auxiliar não bloqueia análise nem confirmação.
- [ ] Verificar dashboard diário após confirmação.
- [ ] Verificar relatório semanal após confirmação.

## Smoke tests WhatsApp

- [ ] Enviar texto e validar resposta automática com alimentos e macros.
- [ ] Enviar áudio e validar transcrição + resposta automática.
- [ ] Enviar imagem e validar análise sem bloquear o fluxo caso o visual auxiliar falhe.
- [ ] Validar que o envio sai sempre pelo `WHATSAPP_PHONE_NUMBER_ID` oficial.
- [ ] Validar comportamento seguro para telefone sem vínculo.

## Observabilidade e segurança

- [ ] Confirmar que logs continuam sanitizados.
- [ ] Confirmar ausência de prompt cru, texto cru, áudio, imagem, transcrição, token e payload externo em logs.
- [ ] Monitorar eventos de warning para `food_photo.visual_generation_warning` e `audio.transcription_warning`.
- [ ] Validar mensagens públicas sem stack, segredo, URL assinada ou conteúdo sensível.

## Gates antes de merge/deploy

- [ ] `pnpm check`
- [ ] `pnpm test`
- [ ] `pnpm architecture:check`
- [ ] `pnpm docs:check`
- [ ] `pnpm agent:check`

## Critério final de liberação

- [ ] Fluxo principal de refeição funcional em web e WhatsApp.
- [ ] Falhas externas tratadas sem bloquear confirmação.
- [ ] Segredos apenas no backend.
- [ ] Dependência legada remanescente documentada e fora do fluxo principal.
