# Especificação de produto: integrações de saúde

## Objetivo

Permitir que atividades externas de saúde, inicialmente Strava, alimentem o diário do usuário com exercícios, gasto calórico e contexto para metas ajustadas, sem exigir lançamento manual duplicado.

## Escopo atual

- Integração OAuth por usuário.
- Estado de configuração visível quando credenciais obrigatórias não estão disponíveis.
- Autorização do Strava com escopos mínimos para leitura de atividades.
- Callback OAuth no backend, troca de `code` por tokens e sincronização inicial.
- Persistência segura do vínculo OAuth em `appSecrets`, com tokens criptografados e restritos ao backend.
- Sincronização manual ou automática de atividades recentes para exercícios do sistema.
- Deduplicação por referência externa para evitar recriar a mesma atividade em sincronizações repetidas.
- Notificação WhatsApp idempotente por atividade externa Strava, usando chave estável `userId + provider + externalId`, para impedir reenvio em retries, sincronização manual repetida ou sincronização automática sobreposta.

## Regras de produto

- Atividades importadas devem aparecer como exercícios do usuário e contribuir para a meta ajustada de calorias do dia.
- A sincronização deve priorizar atividades com duração e calorias válidas retornadas pelo provedor externo.
- Quando a atividade não tiver calorias confiáveis, o sistema pode usar fallback local documentado, mas deve preservar a origem externa e evitar mascarar a ausência do dado real.
- Sincronizações repetidas não devem criar exercícios duplicados para a mesma atividade externa.
- A mensagem WhatsApp de exercício importado deve ser enviada apenas uma vez por atividade externa Strava; atualizações posteriores do mesmo exercício devem atualizar/ignorar o registro sem reenviar a notificação, salvo regra explícita futura.
- A interface deve deixar claro se o provedor está conectado, pendente de configuração, desconectado ou com erro operacional.
- Falhas de sincronização devem ser tratadas de forma recuperável e sanitizada, sem expor tokens, payload bruto ou dados sensíveis em logs/mensagens.
- Desconexão ou revogação deve impedir novas sincronizações e respeitar os fluxos de exportação/exclusão de privacidade.

## Dados sensíveis

- Tokens OAuth e refresh tokens.
- Identificadores externos de atleta/atividade.
- Atividades físicas, duração, distância, elevação, calorias e métricas detalhadas.
- Frequência cardíaca, cadência, potência, visibilidade e equipamento quando disponíveis.

Esses dados seguem `docs/PRIVACY_LGPD.md` e não devem aparecer em analytics ou logs crus.

## Critérios de aceite

- Usuário consegue iniciar conexão Strava quando as variáveis de ambiente obrigatórias estão configuradas.
- Tela de integrações mostra estado claro quando `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` ou `STRAVA_REDIRECT_URI` estão ausentes.
- Callback OAuth grava o vínculo de forma segura no backend.
- Sincronização importa atividades válidas como exercícios do sistema.
- Importações repetidas atualizam ou ignoram atividades já importadas, sem duplicidade.
- Exercícios importados aparecem em Hoje, Registros e Relatórios quando estiverem no intervalo consultado.
- Logs de sincronização usam apenas contadores, status e mensagens sanitizadas.
- Notificação WhatsApp de integração Strava é protegida contra duplicidade por `externalId`; a mesma atividade não deve gerar nova mensagem quando a sincronização manual ou automática roda novamente.

## Notas de implementação

- O provider Strava deve ficar sob `server/modules/healthIntegrations/strava/`.
- Tokens devem ser armazenados com criptografia via `appSecrets`.
- A origem externa deve ser persistida de forma rastreável, preferencialmente com campos dedicados como `externalProvider` e `externalId` quando disponíveis no schema.
- A proteção de notificação deve ser independente da resposta visual da tela: mesmo que a importação retorne `created` novamente por retry ou corrida de sincronização, a chave de notificação por atividade externa deve impedir spam no WhatsApp.
- Ao investigar ausência de exercícios importados, confira primeiro se as migrations de campos/índices de `exercises` realmente foram aplicadas no banco de produção.
- A documentação de privacidade deve ser atualizada sempre que novos dados externos forem persistidos, exportados ou excluídos.
