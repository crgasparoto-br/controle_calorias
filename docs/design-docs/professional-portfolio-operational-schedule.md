# Agenda operacional da carteira profissional

Este documento é a fonte canônica específica para agenda e filtros da carteira e
substitui a ressalva genérica ainda presente em `docs/product-specs/professionals.md`
sobre revisão e pesagem dependerem de fases futuras. As colunas operacionais já
existem no acompanhamento profissional e devem ser consumidas pela carteira.

A carteira profissional usa `professionalPatientTrackings.nextReviewAt` e
`professionalPatientTrackings.nextWeighingAt` como fontes canônicas opcionais.
Essas colunas são declaradas em `drizzle/professional-schema.ts`, fazem parte da
migration Drizzle versionada e possuem índices compostos com `professionalUserId`.
O reparo de compatibilidade em runtime é apenas uma proteção para ambientes de
desenvolvimento antigos; ele não substitui schema, migration nem `pnpm db:push`.

- Datas ausentes são exibidas como “Não informado” ou “Sem revisão agendada”,
  nunca como zero.
- O filtro de revisão distingue agendada, próxima em até sete dias, atrasada e
  indisponível.
- Todos os filtros de revisão só alcançam vínculos com autorização `approved`.
- Revisões e pesagens com data vencida entram nos totais de pendências do painel.
- Busca, filtros e página são persistidos na query string da rota da carteira,
  permitindo abrir um paciente e retornar ao mesmo estado operacional.
- A consulta permanece paginada, ordenada de forma estável e isolada pelo
  profissional autenticado.
- Vínculos pendentes, recusados e revogados não recebem datas, acompanhamento ou
  outros dados operacionais protegidos no payload público.

## Validação obrigatória

Mudanças nessas colunas ou filtros devem ser verificadas no TiDB real pelo workflow
`Professional persistence TiDB gate`. O cenário discriminante deve gravar uma
revisão futura, uma revisão vencida e uma revisão ausente, comprovando os filtros
`scheduled`, `due_soon`, `overdue` e `unavailable`. A geração Drizzle não pode
produzir diff residual depois que a migration e o snapshot forem commitados.
