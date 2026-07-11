# Privacidade e LGPD

Este projeto processa dados de saúde e hábitos alimentares. Trate toda mudança em IA, WhatsApp, mídia, logs, analytics, exportação, exclusão, acesso profissional e integrações de saúde como mudança sensível.

## Dados pessoais e sensíveis

| Categoria | Exemplos | Onde aparece |
|---|---|---|
| Identidade | Nome, e-mail, `openId`, telefone WhatsApp e nome exibido | `users`, `userProfiles`, `whatsappConnections` |
| Saúde/nutrição | Idade, altura, peso, objetivo, restrições, refeições, macros, hidratação e exercícios | `userProfiles`, `weightEntries`, `meals`, `mealItems`, `waterLogs`, `exercises` |
| Conteúdo bruto | Texto de refeição, transcrição, imagem, áudio, notas livres e mídia | `mealMedia`, `mealInferences`, fluxos de IA e WhatsApp |
| Contexto conversacional | Mensagens sanitizadas, transcrições sanitizadas, referências opacas de mídia, resumos e vínculos de domínio | `whatsappConversations`, `whatsappConversationMessages`, `whatsappConversationSummaries`, `whatsappMessageDomainLinks` |
| Integrações externas | Tokens OAuth, identificadores externos, atividades importadas do Strava, distância, duração, elevação, frequência cardíaca, cadência e potência | `appSecrets`, módulos de integrações de saúde |
| IA | Prompt, contexto nutricional, reasoning, confidence, inferências e logs | `server/_core`, `server/modules/assistant`, `server/modules/meals` |
| Operação | Tokens, IDs de canal, URLs de mídia, detalhes técnicos e logs de erro | `appSecrets`, logs operacionais e analytics |
| Compartilhamento profissional | Solicitações, consentimento aprovado/revogado, comentários e sugestões | módulo `professionals` |

## Princípios

- Minimização: persistir apenas o necessário para o produto.
- Finalidade: documentar por que cada novo dado sensível é necessário.
- Transparência: exportação deve ser compreensível para o usuário.
- Segurança: logs, analytics e mensagens de erro devem ser sanitizados.
- Retenção: dados brutos de IA, mídia, logs, contexto conversacional e integrações externas devem ter retenção intencional, não acidental.
- Consentimento: fluxos de profissional, WhatsApp, IA multimodal e integrações externas devem respeitar autorização explícita ou ação consciente do usuário.

## Regras práticas

- Não logar `sourceText`, `transcript`, `reasoning`, token, telefone completo, URL assinada, payload bruto de atividade externa ou objetos crus de saúde.
- Não enviar dados de saúde identificáveis para analytics.
- Usar `safeLogDetail` ou helper equivalente para detalhes operacionais.
- Sanitizar erros de IA, webhooks, storage, OAuth e integrações antes de persistir ou exibir.
- Ao adicionar integração externa, documentar dados enviados/recebidos, motivo, retenção e comportamento de exclusão.
- Tokens do Strava devem permanecer criptografados em `appSecrets`; logs de sincronização automática devem conter apenas contadores, status e mensagens sanitizadas.
- Atividades do Strava são importadas para exercícios para manter o diário do usuário atualizado sem sincronização manual.
- Métricas detalhadas do Strava, incluindo frequência cardíaca, cadência, potência, equipamento, visibilidade e contadores sociais, devem ser exibidas apenas para o usuário autenticado e não devem aparecer em logs ou analytics.
- O escopo `activity:read_all` deve ser usado apenas para permitir importação de atividades privadas ou Only Me quando o usuário reconectar e conceder esse acesso.
- Mídias salvas em qualquer provider devem usar chaves opacas, sem telefone, `userId`, `imageId`, `audioId` ou nome original no caminho persistido.
- URLs públicas devem ser usadas apenas para artefatos que precisam sair do backend, como a imagem anotada enviada pelo WhatsApp. Mídias originais e recebidas devem manter referência interna quando armazenadas pelo backend.
- Se um bucket tiver domínio público de leitura, trate a posse do caminho do objeto como acesso potencial à mídia. Não registre caminhos completos em logs desnecessários e configure lifecycle policy para limitar retenção.
- A exclusão de conta remove os vínculos e linhas principais do produto. Objetos externos exigem rotina operacional ou lifecycle policy até existir deleção automatizada por chave.
- Ao adicionar tabela/campo sensível, atualizar `docs/generated/db-schema.md`.

## Contexto persistente do WhatsApp

- A chave idempotente usa o `message.id` da Meta somente para impedir duplicação; o payload bruto da Meta não é persistido como log operacional.
- Texto e transcrição passam pela política de sanitização antes de alimentar contexto ou resumo. A retenção de conteúdo bruto é separada da retenção sanitizada e da trilha de auditoria.
- Imagem e áudio são representados no contexto por chave opaca e MIME type; URL temporária, telefone e identificador externo da mídia não devem compor a chave persistida.
- Resumos guardam proveniência por intervalo de mensagens e nunca substituem os dados nutricionais atuais como fonte de verdade.
- Vínculos entre mensagem e refeição, item, água, peso ou exercício são auditáveis e não devem duplicar o registro de domínio.
- Os modos `legacy`, `write_only`, `shadow` e `persistent` registram somente contadores, origem escolhida, fluxo, truncamento e divergência booleana. O conteúdo comparado não entra na telemetria.
- Rollback desativa leitura persistente por fluxo e mantém escrita, schema, retenção e dados já gravados; não deve executar downgrade destrutivo.
- Limpeza do histórico conversacional não pode remover refeições, itens, água, peso, exercícios ou outros dados nutricionais.

## Exportação e exclusão

A especificação funcional está em `docs/product-specs/privacy-export-deletion.md`.

O endpoint autenticado `nutrition.privacy.exportData` deve retornar os dados principais do próprio usuário em formato compreensível, incluindo conta/perfil, metas, refeições, exercícios, hidratação, peso, preferências, restrições e estado de canais quando aplicável.

O endpoint autenticado `nutrition.privacy.requestAccountDeletion` deve remover ou desvincular dados principais vinculados ao usuário, incluindo conta, perfil, refeições, itens, mídias, favoritos, inferências, hábitos, metas, água, exercícios, preferências, restrições, gamificação, vínculos WhatsApp, contexto conversacional e logs de inferência. Alimentos criados pelo usuário podem ser desvinculados quando a remoção direta causar conflito de integridade.

Backups, logs de infraestrutura fora do banco e arquivos externos em storage dependem de política operacional de retenção ou automação específica.

## IA e serviços externos

O assistente alimentar não deve enviar nome, e-mail ou identificador interno do usuário para o provedor de IA. Ainda assim, preferências, restrições alimentares, texto livre, foto, áudio ou transcrição podem conter dados sensíveis e devem ser tratados como conteúdo protegido.

Foto, áudio e transcrição podem envolver serviços externos de transcrição, visão ou LLM. Sempre que o fluxo usar mídia com IA, mantenha o comportamento documentado, evite retenção acidental e prefira URLs com expiração quando houver necessidade de acesso externo.

## Riscos conhecidos e cuidados recorrentes

- Novos `console.*` ou logs de objetos crus podem vazar dados sensíveis se não forem revisados.
- Dados de saúde em tabelas principais dependem da criptografia do banco/disco gerenciado; o código atual não aplica criptografia de campo ampla.
- Mídias em storage externo podem exigir lifecycle policy ou rotina de deleção por chave para alinhamento completo com exclusão de conta.
- `mealInferences.sourceText`, transcrições e contexto conversacional armazenam conteúdo alimentar sensível; alterações nessa área devem avaliar minimização e retenção curta.
- Integrações de saúde devem manter rastreabilidade externa suficiente para evitar duplicidade sem expor identificadores sensíveis em logs.

## Checklist para PRs sensíveis

- [ ] O dado coletado é necessário?
- [ ] Existe base clara no produto para uso do dado?
- [ ] Exportação e exclusão continuam coerentes?
- [ ] Logs e analytics foram sanitizados?
- [ ] Dados de IA, mídia, WhatsApp e integrações externas têm retenção intencional?
- [ ] Documentação canônica foi atualizada?
