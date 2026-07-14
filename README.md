# Controle de Calorias

Controle de Calorias é uma plataforma de acompanhamento nutricional contínuo com registro multimodal de refeições, revisão antes de persistência, acompanhamento de metas e operação por web e WhatsApp. O projeto segue como um monólito React + Express + tRPC + Drizzle, com a camada principal de IA isolada no backend.

O produto possui duas experiências de primeira classe sobre os mesmos dados e serviços:

- **Área do Paciente**, que corresponde à experiência pessoal já desenvolvida e funciona com ou sem vínculo profissional;
- **Área Profissional**, que evolui como ambiente próprio para nutricionistas administrarem carteira, metas, orientações, acompanhamento e comunicação.

O principal cliente pagante e foco comercial inicial é o nutricionista com atendimento individual. O paciente continua sendo usuário central da plataforma e também pode utilizar o sistema de forma independente. A especificação canônica desta decisão está em `docs/product-specs/product-experience-model.md`.

## O que o produto faz hoje

| Domínio | Situação atual |
|---|---|
| Registro alimentar | Entrada por texto, imagem, áudio e cadastro manual |
| Inferência nutricional | Núcleo compartilhado entre web e WhatsApp, validado com Zod. Suporta OpenAI e Gemini 2.5 Flash. |
| Confirmação | Persistência apenas após revisão/fluxo equivalente |
| Autenticação web | Cadastro e login próprios com nome, e-mail e senha |
| Sessão | Cookie HTTP-only assinado com `JWT_SECRET` |
| WhatsApp | Entrada e resposta pelo número oficial configurado |
| Relatórios | Dashboard diário, visão semanal e detalhamento por refeição |
| Área Profissional | Perfil adicional, vínculos autorizados, visão de dados, comentários, sugestões e apoio da IA; evolução planejada para ambiente dedicado |
| Operação administrativa | Status do canal e atualização segura do token do WhatsApp |
| Saúde externa | Conexão OAuth persistente com Strava, importação automática por webhook e importação manual via API/tRPC |

## Modelo de experiência

A Área do Paciente não será reescrita para viabilizar a estratégia profissional. Ela permanece como produto completo para registros, metas, relatórios, peso, exercícios, integrações e uso pessoal do WhatsApp.

A Área Profissional será desenvolvida separadamente, com navegação e páginas próprias, reutilizando serviços canônicos de domínio. A tela profissional atual com abas é uma linha de base funcional que deve ser preservada durante a transição.

As issues são separadas em quatro fluxos para evitar ampliação indevida de escopo:

1. experiência atual do paciente;
2. plataforma compartilhada;
3. programa da Área Profissional;
4. comercial e billing.

Correções já abertas mantêm seu objetivo original. Novos dashboards, prontuário, carteira, acompanhamento e comunicação do nutricionista pertencem à épica profissional específica, enquanto billing, onboarding comercial, timezone e infraestrutura do WhatsApp permanecem em seus programas próprios.

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

## Seleção de Provider de IA (Visão e Texto)

O projeto suporta a troca de provedor de IA via variável de ambiente, sem necessidade de alteração de código. O provedor selecionado será usado para reconhecimento de foto de refeição, classificador de intenção (WhatsApp) e busca semântica de catálogo.

- **OpenAI (Padrão):**
  ```env
  AI_VISION_PROVIDER=openai
  OPENAI_API_KEY=<sua_chave_openai>
  OPENAI_MODEL=gpt-4.1-mini # opcional
  ```

- **Gemini (Recomendado para melhor reconhecimento de imagens):**
  ```env
  AI_VISION_PROVIDER=gemini
  GEMINI_API_KEY=<sua_chave_google_ai_studio>
  GEMINI_MODEL=gemini-2.5-flash # opcional
  ```

*Nota: A transcrição de áudio (Whisper) e a geração de imagem anotada continuam usando OpenAI independentemente do provedor selecionado. Portanto, `OPENAI_API_KEY` deve ser mantida.*

## Variáveis de ambiente obrigatórias

Configure estas variáveis no backend/runtime responsável pela API:

### Obrigatórias em produção

- `JWT_SECRET`: segredo usado para assinar sessões locais. Também é usado como fallback legado para derivar a chave de criptografia de segredos internos (ex.: token do WhatsApp) enquanto `APP_SECRETS_ENCRYPTION_KEY` não estiver configurada — veja a seção "Criptografia de segredos persistidos" abaixo.
- `DATABASE_URL`: conexão MySQL/TiDB usada para persistir contas, metas, refeições, integrações e dados sensíveis do domínio.

Em `NODE_ENV=production`, o backend aborta o startup quando `JWT_SECRET` ou `DATABASE_URL` estiver ausente, vazio ou composto apenas por espaços. A mensagem informa o nome da variável inválida sem imprimir seu valor.

Em produção, a validação inicial do banco também precisa conseguir abrir a conexão configurada. Se `DATABASE_URL` estiver inválida, inacessível ou apontar para um banco indisponível, o backend não sobe em modo parcialmente funcional.

Em desenvolvimento e teste, o startup pode continuar sem `JWT_SECRET` ou `DATABASE_URL`, mas rotinas que assinam sessão, criptografam/decriptografam segredos ou persistem dados falham explicitamente ou usam fallback em memória apenas quando o ambiente permitir.

### Modo efêmero fora de produção

Fallbacks em memória existem para testes e desenvolvimento local. Em `NODE_ENV=test`, eles ficam liberados automaticamente. Em desenvolvimento, defina `ALLOW_MEMORY_PERSISTENCE=true` apenas quando quiser rodar a aplicação de forma efêmera e ciente de que dados serão perdidos ao reiniciar.

`ALLOW_MEMORY_PERSISTENCE=true` é ignorada em `NODE_ENV=production`; deploy real sempre exige banco persistente.

### Opcionais por feature

A ausência destas variáveis não derruba o backend por si só, mas deixa a feature correspondente indisponível ou desabilitada:

| Feature | Variáveis | Comportamento quando ausentes |
|---|---|---|
| OpenAI / Gemini | `AI_VISION_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL` | Fluxos que dependem do provider ficam indisponíveis se a chave correspondente não estiver configurada. |
| Forge/built-in AI | `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Fluxos dependentes do provider Forge ficam indisponíveis quando esse provider estiver selecionado sem configuração. |
| WhatsApp | `WHATSAPP_PHONE_NUMBER`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN` | Webhook, envio e operação administrativa do canal ficam indisponíveis até configurar o canal oficial. |
| Strava | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI`, `STRAVA_APP_REDIRECT_BASE_URL`, `STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC` | OAuth, webhook e importação manual do Strava ficam desabilitados quando as credenciais obrigatórias estão ausentes. O limite de detalhes usa o padrão seguro quando ausente. |
| Criptografia dedicada de segredos | `APP_SECRETS_ENCRYPTION_KEY` | Quando ausente, segredos persistidos (ex.: token do WhatsApp em `appSecrets`) continuam sendo criptografados com uma chave derivada de `JWT_SECRET` (fallback legado), acoplando rotação de sessão à leitura de segredos. |

`OPENAI_API_KEY` deve existir apenas no backend. Não exponha `OPENAI_*`, `JWT_SECRET`, `APP_SECRETS_ENCRYPTION_KEY`, tokens do WhatsApp ou credenciais de banco via `VITE_*` ou em código executado no navegador.

### Criptografia de segredos persistidos (`APP_SECRETS_ENCRYPTION_KEY`)

O token de acesso do WhatsApp gravado em `appSecrets.valueEncrypted` é criptografado com AES-256-GCM. A chave usada depende da configuração:

- **Chave dedicada configurada** (`APP_SECRETS_ENCRYPTION_KEY`): todo novo segredo é criptografado com essa chave, desacoplada de `JWT_SECRET`. Segredos gravados assim continuam legíveis mesmo depois de `JWT_SECRET` ser rotacionado.
- **Chave dedicada ausente** (fallback legado): o segredo é criptografado com uma chave derivada de `JWT_SECRET`. Isso é compatibilidade temporária — cada payload persistido carrega um marcador (`keySource`) que identifica qual chave foi usada para criptografá-lo, então segredos antigos continuam legíveis independentemente de quando `APP_SECRETS_ENCRYPTION_KEY` for configurada.

Estratégia de migração:

1. Defina `APP_SECRETS_ENCRYPTION_KEY` com um valor aleatório forte (ex.: `openssl rand -hex 32`) em todos os ambientes.
2. A partir do próximo deploy, novos segredos (ou atualizações de segredos existentes, como reconexão do WhatsApp) passam a usar a chave dedicada automaticamente — não há script de reescrita obrigatório.
3. Segredos ainda não reescritos continuam sendo lidos com a chave legada derivada de `JWT_SECRET`. Rotacionar `JWT_SECRET` antes de reescrever esses segredos os torna ilegíveis — force a reescrita (ex.: reenviando o token do WhatsApp) antes de rotacionar `JWT_SECRET` se a chave dedicada ainda não estiver configurada.
4. Risco residual: enquanto algum segredo persistido não tiver sido reescrito com a chave dedicada, ele permanece dependente de `JWT_SECRET`. Nenhum valor de chave ou segredo decriptado é logado; falhas de decriptação retornam erro sanitizado.

`OPENAI_IMAGE_MODEL` pode ser configurada no backend quando o fluxo visual auxiliar estiver habilitado, mas não é necessária para a autenticação nem para o login web.

Durante o startup, o backend registra aviso para features opcionais sem configuração suficiente. Esses avisos não exibem valores de segredos.

## WhatsApp

A integração usa um único número oficial da solução. O `WHATSAPP_PHONE_NUMBER_ID` identifica o canal de envio e recebimento; o telefone de origem do usuário final é salvo apenas como vínculo com o usuário autenticado.

O webhook localiza o usuário pelo telefone de origem, processa a refeição no contexto desse usuário e responde pelo mesmo canal oficial configurado no ambiente.

**Inteligência do WhatsApp:**
O canal possui um classificador de intenções (LLM) que atua antes do pipeline nutricional para evitar registros acidentais. Ele avalia o histórico conversacional recente do usuário para resolver ambiguidades (ex: distinguir "frango grelhado" como consulta vs. registro). O sistema também conta com aprendizado silencioso de aliases pessoais, associando automaticamente apelidos informais aos nomes canônicos do catálogo após registros bem-sucedidos.

A evolução da comunicação profissional deve reutilizar esse canal e o contrato central de mensagens, distinguindo conteúdo automático, sugestão da IA e mensagem enviada pelo nutricionista. Não deve existir transporte paralelo exclusivo para a Área Profissional.

## Strava

A integração com Strava usa OAuth 2.0 no backend. O botão da tela de saúde externa inicia a autorização, redireciona o usuário para login/autorização no Strava e o callback em `/api/health-integrations/strava/callback` conclui a conexão.

`STRAVA_REDIRECT_URI` deve apontar para o callback público da API, por exemplo `https://api.seudominio.com/api/health-integrations/strava/callback`. `STRAVA_APP_REDIRECT_BASE_URL` deve apontar para o domínio do app web onde o usuário está logado, por exemplo `https://app.seudominio.com`. Depois de salvar o vínculo, o callback usa essa base para devolver o usuário ao frontend em `/health-integrations`.

Após o callback, o backend salva o estado OAuth por usuário em `appSecrets`, criptografado com segredo do runtime. O callback não importa atividades automaticamente. A importação automática acontece somente pelo webhook do Strava; quando o usuário quiser trazer histórico ou forçar uma atualização, deve acionar a sincronização manual pela tela/API.

A importação manual lê apenas as atividades dos últimos 2 meses da API do Strava e registra como exercícios no domínio existente quando a atividade tem duração e calorias válidas. O webhook processa os eventos recebidos do Strava e usa o mesmo caminho de persistência de exercícios. Cada exercício importado recebe uma referência externa nas notas (`strava:<activityId>`) para que importações futuras atualizem ou ignorem o mesmo exercício em vez de duplicar o registro.

Quando uma atividade já importada reaparece em uma janela de sincronização ou em novo evento, a referência `strava:<activityId>` é usada para localizar o exercício existente. Se esse exercício já contém calorias confiáveis do Strava nas notas (`Calorias: N kcal`), esse valor é preservado e não é substituído por estimativa local.

`STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC` controla quantas chamadas de detalhe `/activities/{id}` cada importação manual ou processamento de webhook pode fazer para atividades cuja listagem não trouxe calorias válidas. O padrão `5` preserva cota. Configure `all` para tentar enriquecer todas as atividades elegíveis antes de qualquer estimativa local; nesse modo, limites 429 ou falhas temporárias no detalhe interrompem a importação para permitir nova tentativa sem salvar estimativas prematuras.

Tokens de acesso e refresh do Strava continuam restritos ao backend, são armazenados criptografados e não são expostos ao frontend.

## Compatibilidade de schema em runtime

O backend chama `ensureRuntimeSchemaCompatibility()` durante o startup para proteger ambientes locais ou de teste que ainda tenham bases antigas. A rotina cobre apenas compatibilidade conhecida e idempotente: colunas esperadas em `users`, `nutritionGoals`, `foodCatalog`, `mealItems` e `userProfiles`, a tabela `whatsapp_onboarding_leads` e o formato de `nutritionGoals.weekday` como `NOT NULL DEFAULT -1`.

Em `NODE_ENV=production`, essa rotina opera somente em modo de verificação. Ela não executa `ALTER TABLE`, `CREATE TABLE`, `UPDATE` ou qualquer ajuste estrutural amplo. Se encontrar coluna, tabela ou formato pendente, o startup falha com uma mensagem orientando executar as migrations versionadas do Drizzle antes de iniciar o servidor.

Em desenvolvimento e teste, a rotina pode aplicar esses reparos idempotentes para destravar bancos locais legados. Mudanças estruturais permanentes continuam pertencendo ao `drizzle/schema.ts` e ao fluxo de migration (`pnpm db:push` ou pipeline equivalente). Em uma base já atualizada, a validação de startup deve retornar sem itens `added`, `updated` ou `pending`.

## Qualidade e gates

A política completa de validação antes de PR/merge fica em `CONTRIBUTING.md`. Use a tabela desse guia para escolher o gate mínimo por tipo de mudança.

Resumo dos comandos disponíveis neste repositório:

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm build
pnpm agent:check
pnpm db:check-integrity
```

Mudanças em áreas sensíveis, como autenticação, segredos, banco, WhatsApp, OpenAI, Strava ou fluxo nutricional, exigem `pnpm agent:check` e `pnpm build`, além de validação manual específica quando houver integração externa ou fluxo de usuário afetado.

## Rollout

Resumo do rollout:

- configurar `JWT_SECRET` e `DATABASE_URL` somente no backend;
- executar as migrations do Drizzle antes do deploy quando houver alteração de schema;
- validar que `NODE_ENV=production` falha o startup sem `DATABASE_URL` ou com conexão de banco inválida;
- configurar OpenAI apenas no backend do Render ou runtime equivalente;
- manter frontend/Vercel sem `OPENAI_API_KEY`, sem `JWT_SECRET` e sem tokens do WhatsApp;
- configurar as credenciais do Strava apenas no backend;
- configurar `STRAVA_REDIRECT_URI` com o domínio público da API;
- configurar `STRAVA_APP_REDIRECT_BASE_URL` com o domínio público do frontend;
- validar o redirect URI público do Strava apontando para `/api/health-integrations/strava/callback`;
- validar que o usuário volta do Strava para o frontend já autenticado;
- validar que o callback OAuth do Strava conecta a conta sem importar exercícios;
- validar que o webhook do Strava importa novas atividades automaticamente;
- validar que a sincronização manual do Strava importa apenas exercícios dos últimos 2 meses;
- validar que reprocessar uma atividade já importada pelo webhook não duplica o exercício nem troca calorias confiáveis por estimativa local;
- validar que o vínculo Strava continua conectado após restart do backend com banco ativo;
- validar cadastro, login, logout e usuário atual;
- validar web e WhatsApp com smoke tests;
- monitorar apenas erros sanitizados, sem senha, hash, token ou cookie em logs.