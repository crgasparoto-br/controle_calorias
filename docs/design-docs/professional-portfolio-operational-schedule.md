# Agenda operacional da carteira profissional

A carteira profissional usa `professionalPatientTrackings.nextReviewAt` e
`professionalPatientTrackings.nextWeighingAt` como fontes canônicas opcionais.

- Datas ausentes são exibidas como “Não informado”.
- O filtro de revisão distingue agendada, próxima em até sete dias, atrasada e
  indisponível.
- Revisões e pesagens com data vencida entram nos totais de pendências do painel.
- Busca, filtros e página são persistidos na query string da rota da carteira,
  permitindo abrir um paciente e retornar ao mesmo estado operacional.
- A consulta permanece paginada, ordenada de forma estável e isolada pelo
  profissional autenticado.
