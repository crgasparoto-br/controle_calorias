# Timezone nas telas autenticadas

## Fonte de verdade

As telas autenticadas consultam `nutrition.onboarding.timeZone` e usam o timezone efetivo retornado pelo backend. O navegador não participa de filtros, agrupamentos, consultas ou mutações vinculadas ao usuário.

Consultas dependentes de calendário permanecem desabilitadas enquanto a resolução do timezone está pendente. Se a consulta terminar com erro, o shell e as leituras podem continuar em modo degradado com `DEFAULT_APP_TIME_ZONE` para preservar a navegação e evitar carregamento infinito. Nesse estado, `useEffectiveUserTimeZone` mantém `isAuthoritative=false`, `isUsingFallback=true` e o erro original em `resolutionError` para diagnóstico.

O fallback do cliente não se torna autoridade de persistência. Formulários enviam valores civis e o backend resolve novamente o timezone do dono antes de converter ou persistir instantes temporais.

## Conversões e cache

- datas lógicas usam `getDateKeyInTimeZone`;
- `datetime-local` usa os helpers de `shared/timeZone.ts`;
- horários inexistentes em avanço de DST são rejeitados antes da mutação;
- horários ambíguos usam a primeira ocorrência definida pelo contrato central;
- ao alterar o timezone nas configurações/onboarding, caches de perfil, Hoje, Registros, Relatórios, metas, integrações e formulários são invalidados sem exigir novo login.

## Acesso profissional

Telas profissionais consultam `nutrition.professionals.patientTimeZone`. Filtros, períodos, horários e agrupamentos dos registros usam o timezone do paciente; datas operacionais do vínculo usam o timezone do profissional autenticado.

## Validação autoritativa de mutações temporais

Formulários autenticados, inclusive a confirmação de análise de foto, enviam `dateTimeLocal` como horário civil. A mutation resolve o timezone efetivo do dono e converte no servidor com o helper central. `occurredAt` absoluto permanece contrato interno para persistência e providers, não entrada pública dos formulários. Isso impede que clientes alterados contornem a política de DST ou usem o timezone do navegador como autoridade.

A validação local da interface melhora a experiência, mas não substitui a validação do servidor: toda mutação temporal user-scoped repete a conversão civil e a política de DST antes da persistência.
