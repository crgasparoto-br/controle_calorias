# Arquitetura do Controle de Calorias

O projeto permanece como um monólito orientado a produto. Frontend, backend, autenticação, integrações, persistência e contratos tipados ficam no mesmo repositório para acelerar evolução, reduzir coordenação operacional e simplificar validação por agentes.

A plataforma possui duas experiências de primeira classe — Área do Paciente e Área Profissional — sobre os mesmos serviços de domínio. A separação é de navegação, autorização, casos de uso e apresentação; não representa divisão em aplicações, identidades ou microserviços independentes.

## Stack principal

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | React + Vite + Tailwind | Fluxos web, dashboard, formulários e visualizações |
| Backend | Express + tRPC | Contratos tipados, autenticação, orquestração e casos de uso |
| Banco | MySQL/TiDB + Drizzle | Persistência relacional, migrações e integridade referencial |
| IA principal | Provider OpenAI ou Gemini (selecionável) | Transcrição, inferência nutricional multimodal e visual auxiliar opcional |
| IA legada remanescente | Forge restrito ao assistente educativo | Sugestões alimentares fora do fluxo principal de refeição |
| Canal externo | WhatsApp Business Cloud API | Entrada e saída conversacional oficial |
| Testes | Vitest | Cobertura de regras, routers e UI |

## Fronteiras de camadas

```text
client/src/pages               -> composição de tela e chamadas tRPC
client/src/components          -> componentes reutilizáveis de UI
server/nutritionRouter         -> composição de routers, autenticação, schemas e serviços
server/modules/*               -> regra de negócio por domínio
server/modules/timeZone/service.ts -> resolução central do timezone efetivo por dono dos dados
server/repositories/*          -> acesso a dados reutilizável por domínio
server/_core/openaiClient.ts   -> cliente oficial da OpenAI, isolado do domínio
server/_core/geminiProvider.ts -> implementação do provider Gemini (Google Generative AI)
server/_core/aiProvider.ts     -> interface interna e factory que seleciona o provider ativo
server/_core/voiceTranscription.ts -> helper de transcrição baseado no provider interno
server/_core/imageGeneration.ts -> helper visual auxiliar opcional, não bloqueante
server/db.ts                   -> persistência legada e funções agregadoras ainda centralizadas
drizzle/schema.ts              -> fonte de verdade do modelo relacional
shared/*                       -> tipos, cálculos e mensagens sem dependência de ambiente
```

## Fronteiras das áreas de experiência

A decisão de produto canônica está em `docs/product-specs/product-experience-model.md`.

### Área do Paciente

- Corresponde à experiência pessoal já desenvolvida.
- Deve funcionar com ou sem vínculo profissional.
- É responsável por registro, revisão, histórico, metas pessoais, relatórios, peso, exercícios, integrações e configurações do próprio usuário.
- Não deve depender de perfil profissional, assinatura profissional ou existência de vínculo para executar fluxos pessoais permitidos.
- Não deve conter regras exclusivas de gestão de carteira ou prontuário profissional.

### Área Profissional

- É um contexto próprio de navegação e trabalho para usuários com perfil profissional ativo.
- Deve consumir os mesmos serviços canônicos de refeições, metas, relatórios, peso, exercícios, timezone e WhatsApp, sem duplicar cálculos.
- Deve validar no backend o perfil profissional, o vínculo vigente, o consentimento e o paciente alvo.
- Não deve importar páginas pessoais para simular a sessão do paciente nem usar impersonação.
- Toda mutação profissional deve carregar ator profissional e paciente afetado de forma separada.
- A tela única com abas existente deve ser preservada durante a transição, mas a direção arquitetural é evoluir para páginas próprias de dashboard, carteira, prontuário, acompanhamento, mensagens, relatórios e configurações.

### Serviços compartilhados

Os domínios compartilhados continuam independentes das telas que os consomem:

- serviços de refeições não devem conhecer dashboard profissional;
- cálculos de metas e relatórios devem produzir contratos canônicos reutilizáveis;
- resolução de timezone usa sempre o dono dos dados;
- transporte e serialização do WhatsApp permanecem centrais;
- autorização profissional envolve ator e paciente, mas não deve duplicar autenticação;
- billing concede entitlements e limites, mas não define a identidade da conta nem implementa a experiência profissional.

### Auditoria e autoria

Operações profissionais que alterem ou orientem o acompanhamento devem preservar, conforme o caso:

- profissional responsável;
- paciente afetado;
- data e hora;
- estado anterior e novo estado;
- vigência;
- justificativa;
- origem da ação: manual, automática ou sugerida pela IA.

A IA não deve executar mutações profissionais automaticamente. Sugestões precisam passar por fluxo explícito e autorizado.

### Separação de entregas

- Correções da Área do Paciente não devem absorver novas telas profissionais.
- Infraestrutura compartilhada deve ser implementada uma vez e consumida pelas duas áreas.
- A evolução da Área Profissional deve possuir épica e subissues próprias.
- Billing e experiência profissional permanecem programas separados, ligados por contratos de entitlement e dependências explícitas.
- Refatoração de domínio não deve ser misturada com mudança visual ou ampliação de produto sem necessidade técnica comprovada.

### Fronteiras do webhook do WhatsApp

`server/whatsappWebhook.ts` é o orquestrador HTTP do canal (deduplicação, roteamento do fluxo por mensagem, chamada aos módulos de domínio) e deve continuar magro. Responsabilidades específicas ficam em módulos dedicados sob `server/modules/whatsapp/`:

- `webhookTextCommands.ts` -> detecção e execução de comandos por texto (água, peso, reclassificação de refeição e confirmação pendente).
- `webhookMediaPipeline.ts` -> download/persistência de mídia recebida (imagem/áudio) e preparo de texto/transcrição para inferência.
- `replyFormatting.ts` -> formatação compartilhada de número e horário nas respostas do WhatsApp.
- `mealConsolidationService.ts` / `mealConsolidation.ts` -> consolidação de refeições do mesmo dia/tipo (ver #663).

A assinatura pública exportada por `server/whatsappWebhook.ts` (`handleWhatsAppWebhook`, `verifyWhatsAppWebhook`, `__resetWhatsAppWebhookDeduplicationForTests`) deve ser preservada ao mover código para esses módulos.

Fluxos de comunicação profissional devem reutilizar o contrato central de mensagens e o transporte oficial. Não criar cliente, formatter ou fila paralela somente para a Área Profissional.

## Regras de dependência

- `client/` pode importar de `shared/`, mas não deve importar de `server/`.
- `server/` pode importar de `shared/`, `drizzle/`, `server/modules/` e `server/repositories/`.
- `shared/` não deve depender de `client/` nem `server/`.
- Serviços não devem depender de componentes React.
- Schemas devem ser reutilizados pelo router e, quando útil, pelo frontend via tipos inferidos.
- O SDK oficial da OpenAI deve ficar restrito à camada `_core` do backend.
- `voiceTranscription`, inferência nutricional e visual auxiliar não devem chamar o provider legado.
- Falha de imagem auxiliar nunca deve bloquear criação ou confirmação de refeição.
- Fluxos multimodais devem usar imagem e áudio inline para inferência e transcrição quando houver mídia anexada; upload para storage serve persistência e não pode ser pré-requisito para a IA consumir a mídia.
- Dependências legadas remanescentes devem ficar documentadas e fora do fluxo principal de refeição.
- Páginas profissionais podem reutilizar componentes visuais genéricos, mas não devem importar páginas da Área do Paciente.
- Regras profissionais devem viver em módulos de domínio/serviço, não em tabs ou páginas React.
- Cálculos de metas, relatórios e timezone devem ter uma fonte canônica compartilhada.
- Autorização profissional não pode depender apenas da visibilidade do menu ou da rota no frontend.

## Plano de extração de `server/db.ts`

A extração de `server/db.ts` deve acontecer em PRs pequenos, cada um focado em um domínio principal e sem mudança funcional intencional. A assinatura pública exportada por `server/db.ts` deve ser preservada enquanto routers e serviços consumidores forem migrados gradualmente.

Checklist recomendado:

- [x] `admin/logs`: preparar serviço isolado para logs administrativos e inferências, mantendo sanitização de detalhes antes de gravar em memória ou banco.
- [x] `users/profile`: mover stores e funções de usuário, onboarding, perfil, preferências, restrições e peso inicial (`server/modules/users/service.ts`), preservando a assinatura pública exportada por `server/db.ts` e expondo acessores para os domínios que ainda leem essa memória (peso semanal, exportação de privacidade e purge de conta).
- [ ] `meals`: seguir o plano detalhado em `docs/exec-plans/active/extract-meals-from-db.md` antes de mover código. A extração deve ser dividida em sublotes pequenos para favoritos, inferências pendentes/mídia, refeições confirmadas/totais, hábitos derivados e agregadores/admin/privacidade, mantendo `server/db.ts` como fachada compatível até a migração dos consumidores.
- [x] `foods`: mover catálogo em memória, favoritos de alimentos, ranking, busca, criação e atualização de alimentos do usuário (`server/modules/foods/catalog.ts`), mantendo `mealStore` e `mealsRepository` como dependências injetadas até a extração do domínio `meals`.
- [x] `water/exercises`: mover metas de água, logs de hidratação, exercícios e consultas por data (`server/modules/water/store.ts`, `server/modules/exercises/store.ts`), preservando a assinatura pública exportada por `server/db.ts`.
- [x] `goals/gamification`: mover metas nutricionais, configurações de gamificação, snapshots semanais de badges e cálculo de conquistas (`server/modules/goals/store.ts`, `server/modules/gamification/store.ts`), preservando `server/db.ts` como fachada compatível.
- [x] `privacy/account`: mover exportação de privacidade, exclusão de dados em memória e orquestração de purge por domínio (`server/modules/privacy/service.ts`), preservando `server/db.ts` como fachada compatível; a orquestração recebe cada domínio como dependência explícita porque `meals` ainda não foi extraído de `server/db.ts`.
- [ ] Atualizar esta seção a cada PR concluído, incluindo qualquer fronteira nova validada por `pnpm architecture:check`.

Regras para cada PR de extração:

- tocar um domínio principal por vez;
- preservar comportamento observável e formatos de retorno;
- adicionar teste focado quando a extração mover sanitização, ordenação, fallback em memória ou persistência;
- evitar misturar refatoração com correção funcional, mudança visual ou alteração de contrato de API;
- manter `pnpm test`, `pnpm architecture:check` e `pnpm docs:check` verdes.

## Privacidade e dados sensíveis

Dados de saúde e alimentação são sensíveis. Campos como `sourceText`, `transcript`, `mediaJson`, restrições alimentares, objetivos, peso, telefone, logs de inferência e tokens exigem cuidado extra.

Proibições:

- não logar texto cru de refeição, transcrição, tokens, URLs assinadas ou telefone completo;
- não enviar dados sensíveis para analytics;
- não retornar detalhes internos de erro para o usuário final;
- não persistir novo dado sensível sem documentar finalidade, retenção e exclusão;
- não expor dados de um paciente a profissional sem vínculo vigente e escopo autorizado;
- não misturar dados pessoais do nutricionista com dados do paciente selecionado.

## Comandos de qualidade

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

`pnpm agent:check` é o gate recomendado para mudanças feitas com auxílio de agentes.