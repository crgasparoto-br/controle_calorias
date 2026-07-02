# Idempotencia da importacao de exercicios Strava

A importacao de atividades do Strava persiste a referencia externa do exercicio em campos estruturados de `exercises`:

- `externalProvider`: provedor de origem, atualmente `strava`.
- `externalId`: ID original da atividade no provedor.

A combinacao `userId`, `externalProvider` e `externalId` possui indice unico. Isso impede que duas sincronizacoes concorrentes criem mais de um exercicio para a mesma atividade externa do mesmo usuario.

## Compatibilidade com registros antigos

Registros antigos podem conter apenas a referencia textual `strava:<activityId>` em `notes`. A migration `0017_strava_external_exercise_reference.sql` faz backfill dessa referencia para os novos campos estruturados.

Quando a migration encontra duplicados historicos com a mesma combinacao de usuario e referencia Strava, ela preserva todos os registros, mas deixa a referencia estruturada apenas no registro canonico mais recente (`updatedAt` e, em empate, maior `id`). Os demais recebem uma nota operacional e ficam com `externalProvider`/`externalId` nulos para permitir a criacao segura do indice unico sem descartar dados silenciosamente.

## Notificacoes WhatsApp

O envio de WhatsApp ocorre somente quando o upsert informa criacao real do exercicio. Reimportacoes sequenciais ou concorrentes que resultam em atualizacao de exercicio existente registram `strava.import.notification_skipped_idempotent` e nao enviam nova notificacao.

Se a mensagem interativa com botao for recusada pela Meta e houver URL de edicao rapida, o fallback textual preserva o link no formato `Ver exercicio: <url>`. Se nao houver WhatsApp ativo ou nao houver exercicio persistido, a notificacao e registrada como ignorada.