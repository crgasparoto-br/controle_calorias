# Controle de Calorias

Controle de Calorias é uma plataforma de nutrição com registro multimodal de refeições, revisão antes de persistência, acompanhamento de metas e operação por web e WhatsApp. O projeto segue como um monólito React + Express + tRPC + Drizzle, com a camada principal de IA isolada no backend.

## O que o produto faz hoje

| Domínio | Situação atual |
|---|---|
| Registro alimentar | Entrada por texto, imagem, áudio e cadastro manual |
| Inferência nutricional | Núcleo compartilhado entre web e WhatsApp, validado com Zod |
| Confirmação | Persistência apenas após revisão/fluxo equivalente |
| Autenticação web | Cadastro e login próprios com nome, e-mail e senha |
| Sessão | Cookie HTTP-only assinado com `JWT_SECRET` |
| WhatsApp | Entrada e resposta pelo número oficial configurado |
| Relatórios | Dashboard diário, visão semanal e detalhamento por refeição |
| Operação administrativa | Status do canal e atualização segura do token do WhatsApp |
| Saúde externa | Conexão OAuth persistente com Strava e sincronização de atividades recentes como exercícios |

## Autenticação própria

A aplicação usa autenticação local com e-mail e senha. O frontend acessa `/login` e `/register`; o backend expõe procedures tRPC para cadastro, login, logout e usuário atual.

A sessão é gravada em cookie HTTP-only. Em produção, o cookie usa `secure` e a política `sameSite` definida pelo backend. O JWT de sessão é assinado exclusivamente no backend com `JWT_SECRET` e carrega somente dados locais do usuário: `userId`, `email`, `name` e `role`.

Senhas nunca devem ser persistidas em texto puro, retornadas para o frontend ou gravadas em logs. O backend armazena apenas hash de senha em `users.passwordHash`.

## Fluxo de refeição

1. O usuário envia texto, imagem ou áudio.
2. O backend monta um rascunho revisável com itens, porções e macros.
3. O usuário revisa ou confirma pelo fluxo conversacional.
4. A refeição confirmada alimenta dashboard, relatórios e hábitos.

A confirmação de refeição não depende de chamada externa. Falhas de transcrição, inferência ou imagem auxiliar são tratadas de forma controlada para não corromper dados nem bloquear a confirmação local.

## Estado da migração OpenAI

A migração segue o plano em `docs/exec-plans/active/migrate-ai-to-openai.md`.

Situação atual:

- Transcrição de áudio usa o provider OpenAI isolado no backend.
- Inferência nutricional de texto e imagem usa o provider OpenAI com saída estruturada e validação Zod.
- Geração visual auxiliar é opcional. Se falhar ou não estiver configurada, a análise da refeição continua normalmente.

## Variáveis de ambiente obrigatórias

Configure estas variáveis no backend/runtime responsável pela API:

- `DATABASE_URL`
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_TRANSCRIPTION_MODEL`
- `WHATSAPP_PHONE_NUMBER`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REDIRECT_URI`
- `STRAVA_APP_REDIRECT_BASE_URL`

`OPENAI_API_KEY` deve existir apenas no backend. Não exponha `OPENAI_*`, `JWT_SECRET`, tokens do WhatsApp ou credenciais de banco via `VITE_*` ou em código executado no navegador.

`OPENAI_IMAGE_MODEL` pode ser configurada no backend quando o fluxo visual auxiliar estiver habilitado, mas não é necessária para a autenticação nem para o login web.

## WhatsApp

A integração usa um único número oficial da solução. O `WHATSAPP_PHONE_NUMBER_ID` identifica o canal de envio e recebimento; o telefone de origem do usuário final é salvo apenas como vínculo com o usuário autenticado.

O webhook localiza o usuário pelo telefone de origem, processa a refeição no contexto desse usuário e responde pelo mesmo canal oficial configurado no ambiente.

## Strava

A integração com Strava usa OAuth 2.0 no backend. O botão da tela de saúde externa inicia a autorização, redireciona o usuário para login/autorização no Strava e o callback em `/api/health-integrations/strava/callback` conclui a conexão.

`STRAVA_REDIRECT_URI` deve apontar para o callback público da API, por exemplo `https://api.seudominio.com/api/health-integrations/strava/callback`. `STRAVA_APP_REDIRECT_BASE_URL` deve apontar para o domínio do app web onde o usuário está logado, por exemplo `https://app.seudominio.com`. Depois de salvar o vínculo, o callback usa essa base para devolver o usuário ao frontend em `/health-integrations`.

Após o callback, o backend salva o estado OAuth por usuário em `appSecrets`, criptografado com segredo do runtime, e tenta uma primeira sincronização das atividades recentes do atleta autenticado. Com `DATABASE_URL` configurado, o vínculo permanece disponível após restart do servidor; em ambiente sem banco, o vínculo continua apenas em memória para desenvolvimento.

A sincronização lê atividades recentes da API do Strava e registra como exercícios no domínio existente quando a atividade tem duração e calorias válidas. Cada exercício importado recebe uma referência externa nas notas (`strava:<activityId>`) para que sincronizações futuras atualizem o mesmo exercício em vez de duplicar o registro.

Tokens de acesso e refresh do Strava continuam restritos ao backend, são armazenados criptografados e não são expostos ao frontend.

## Qualidade e gates

Comandos esperados para mudanças neste repositório:

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm build
pnpm agent:check
```

## Rollout

Resumo do rollout:

- configurar `JWT_SECRET` e `DATABASE_URL` somente no backend;
- configurar OpenAI apenas no backend do Render ou runtime equivalente;
- manter frontend/Vercel sem `OPENAI_API_KEY`, sem `JWT_SECRET` e sem tokens do WhatsApp;
- configurar as credenciais do Strava apenas no backend;
- configurar `STRAVA_REDIRECT_URI` com o domínio público da API;
- configurar `STRAVA_APP_REDIRECT_BASE_URL` com o domínio público do frontend;
- validar o redirect URI público do Strava apontando para `/api/health-integrations/strava/callback`;
- validar que o usuário volta do Strava para o frontend já autenticado;
- validar que o vínculo Strava continua conectado após restart do backend com banco ativo;
- validar cadastro, login, logout e usuário atual;
- validar web e WhatsApp com smoke tests;
- monitorar apenas erros sanitizados, sem senha, hash, token ou cookie em logs.