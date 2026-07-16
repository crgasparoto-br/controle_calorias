# Design técnico: timezone efetivo do dono dos dados

## Fonte de verdade

Toda operação vinculada a dados de um usuário usa o timezone efetivo do **dono dos dados**. O contrato é dividido em duas camadas:

- `shared/timeZone.ts`: validação IANA e conversões puras, sem banco ou dependência de ambiente;
- `server/modules/timeZone/service.ts`: leitura central de `userProfiles.timezone` por `userId` e resolução estruturada da origem.

`America/Sao_Paulo` existe somente como `DEFAULT_APP_TIME_ZONE`, usado quando o perfil não existe ou o valor está vazio/inválido. Um identificador IANA válido é preservado mesmo quando não aparece em `USER_TIME_ZONE_OPTIONS`. `UTC` permanece válido e não é convertido pela migration.

## Contrato backend

A resolução retorna:

```ts
type EffectiveUserTimeZone = {
  timeZone: string;
  source: "profile" | "fallback";
  fallbackReason?: "profile_missing" | "empty" | "invalid";
};
```

Falha técnica ao consultar o banco lança `UserTimeZoneResolutionError`; ela não é convertida em ausência de perfil. Logs de fallback registram somente o motivo técnico, sem telefone, texto de mensagem ou dado de saúde.

Cada operação resolve o timezone uma vez e o propaga aos serviços. Não é permitido consultar o perfil por item, registro ou dia de relatório, nem alterar `process.env.TZ`.

## Instante absoluto e data lógica

- timestamps persistidos representam instantes absolutos;
- datas lógicas, agrupamentos, filtros e rótulos são derivados no timezone efetivo;
- limites de consulta usam intervalo UTC semiaberto `[início, fim)`, calculado a partir do calendário local;
- datas civis sem horário não são reinterpretadas como timestamp;
- mudar o timezone altera consultas e agrupamentos futuros, sem regravar histórico.

## `datetime-local` e DST

`zonedDateTimeLocalToDate` valida a conversão por round-trip:

- horário inexistente no avanço do DST é rejeitado;
- horário ambíguo no retorno do DST usa a primeira ocorrência, isto é, o menor instante UTC e o offset anterior;
- frontend e backend usam o mesmo helper compartilhado.

Exemplos obrigatórios de regressão:

- `America/New_York`, `2026-03-08T02:30`: inválido;
- `America/New_York`, `2026-11-01T01:30`: `2026-11-01T05:30:00.000Z`.

## Persistência e migration

`userProfiles.timezone` possui default `America/Sao_Paulo`. A migration `0024_timezone_default.sql`:

1. normaliza somente valores `NULL` ou vazios;
2. altera o default da coluna;
3. não altera valores IANA válidos, inclusive `UTC`.

Valores legados inválidos são tratados pelo fallback central até que exista uma correção comprovadamente segura para o registro específico.
