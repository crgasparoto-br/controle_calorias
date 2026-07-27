# Área Profissional — rotas, segurança e regressão

## Rotas canônicas

| Superfície                  | Rota                                           | Contexto |
| --------------------------- | ---------------------------------------------- | -------- |
| Início profissional         | `/professional`                                | agregado |
| Carteira                    | `/professional/patients`                       | agregado |
| Prontuário                  | `/professional/patients/:patientId`            | paciente |
| Avaliação                   | `/professional/patients/:patientId/assessment` | paciente |
| Metas                       | `/professional/patients/:patientId/goals`      | paciente |
| Orientações                 | `/professional/patients/:patientId/guidance`   | paciente |
| Anotações                   | `/professional/patients/:patientId/notes`      | paciente |
| Histórico                   | `/professional/patients/:patientId/history`    | paciente |
| Relatório individual        | `/professional/patients/:patientId/reports`    | paciente |
| Conversa individual         | `/professional/patients/:patientId/messages`   | paciente |
| Mensagens da carteira       | `/professional/messages`                       | agregado |
| Relatórios da carteira      | `/professional/reports`                        | agregado |
| Configurações profissionais | `/professional/settings`                       | agregado |

`/professional/follow-up` é legado e redireciona para a carteira. O identificador do paciente deve ser inteiro positivo e seguro; valores inválidos não podem disparar consultas.

## Autorizações por superfície

- Carteira: `professional_portfolio`.
- Prontuário, avaliação, metas, orientações, anotações e histórico: `professional_record`.
- Relatório individual e agregado: `professional_reports`.
- Mensagens individuais e agregadas: `professional_messages`.
- Configurações: `professional_settings`.
- Início: `professional_dashboard`.

A URL é a única fonte de verdade para o paciente ativo. Nenhum seletor global ou estado React pode manter um paciente diferente da rota.

A consulta canônica `professionalRecord.context` recebe o `patientId` e o recurso exato da rota. Ela confirma perfil ativo, entitlement correspondente e autorização aprovada sem depender de `professional_portfolio` ou de uma consulta ao prontuário. Relatórios e mensagens não podem adquirir `professional_record` como requisito indireto; metas seguem o contrato da rota e usam `professional_record` em frontend e backend.

A resolução do timezone é um contrato compartilhado do paciente autorizado. Ela pode ser usada por carteira, prontuário, relatórios ou mensagens quando pelo menos um desses recursos estiver habilitado, sem criar dependência indireta de `professional_portfolio`.

Recursos complementares, como alertas operacionais e assistência de IA, mantêm entitlements próprios. A ausência desses recursos produz `PRECONDITION_FAILED` e não deve ser confundida com perda do vínculo ou do entitlement principal da rota.

## Troca e revogação de paciente

Ao trocar de paciente, sair da rota individual, perder autorização ou desativar a Área Profissional:

1. cancelar consultas individuais em andamento;
2. remover do cache prontuário, contexto, timezone, dashboards, relatórios, metas, alertas, mensagens e dados de IA individuais;
3. impedir a renderização de dados antigos enquanto a nova autorização é confirmada;
4. redirecionar para a carteira quando o acesso não estiver mais disponível;
5. preservar vínculos e histórico persistidos ao desativar a área, mas bloquear novas operações.

A limpeza é acionada imediatamente pelo canal SSE autenticado quando `revokeAccess` persiste a revogação, sem depender de clique, foco ou nova mutation do profissional. Refetch, foco e erros de query/mutation continuam como defesa em profundidade para reconexão ou indisponibilidade transitória do canal. A negação do entitlement exato de `professionalRecord.context` é convertida para tRPC `FORBIDDEN` e também limpa o contexto. `reset` isolado não é suficiente: as queries individuais precisam ser removidas do cache.

O stream `/api/professional/access-events` autentica a sessão, valida o `patientId` e o entitlement exato antes de abrir a conexão, isola listeners pelo par profissional/paciente e envia somente `patientId` e `occurredAt`. A entrega local é imediata após a persistência; uma verificação server-side curta do status canônico cobre revogações processadas por outra instância sem criar polling no navegador. A desconexão remove o listener e não altera o estado autorizado; o contexto canônico continua sendo a fonte de verdade.

Um `FORBIDDEN` não pode ser usado genericamente para inferir revogação quando pertence a uma capacidade complementar. Alertas ou IA ausentes não removem um paciente que continua autorizado para prontuário, relatórios ou mensagens.

Eventos assíncronos precisam ser correlacionados ao paciente atual. Queries usam a chave tRPC e o `patientId` do input. Mutations usam o `patientId` das variáveis quando disponível; operações identificadas apenas por `accessId`, `goalId`, `messageId` ou `alertId` só podem revogar o contexto quando a chave da mutation é individual e a operação foi enviada depois da validação do paciente atualmente presente na URL. Uma resposta tardia do paciente anterior deve ser ignorada.

## Acompanhamento encerrado

Quando o acompanhamento está `ended`, qualquer rota individual diferente de `/history` redireciona para a linha do tempo auditável antes de montar relatórios, mensagens ou formulários. O backend não retorna avaliação, anotações ou orientações por `professionalRecord.get`, e bloqueia timezone, dashboard, relatório de período e conversa individual. A timeline pública contém somente identificador opaco do evento, tipo de domínio permitido e data; identificadores técnicos da entidade não atravessam o contrato público.

## Proteção de rascunho

Avaliação, orientação, anotação e mensagem devem pedir confirmação antes de trocar de rota, paciente, usar voltar/avançar ou fechar a página quando houver conteúdo não salvo.

- Ao escolher permanecer, o workspace e seus campos devem continuar montados com o rascunho preservado. Em navegadores com Navigation API, o evento `navigate` do tipo `traverse` é cancelado antes da troca de rota; o fallback legado restaura a entrada atual quando essa API não existe.
- Ao confirmar o descarte, os campos não salvos são eliminados e a navegação interna prossegue sem exigir remount quando `patientId` e `authorizationId` permanecem iguais. A paginação independente das coleções continua preservada.
- A troca de `patientId` ou de `authorizationId` sempre remonta o workspace, mesmo quando a seção da URL permanecer igual, para impedir reutilização de rascunho ou estado transitório entre pacientes e ciclos de autorização.
- Salvar ou descartar deve permitir a navegação que encerra aquele rascunho. Se o profissional iniciar uma nova edição na mesma rota, o guard é rearmado e volta a exigir confirmação.
- A paginação do histórico é derivada exclusivamente do total da timeline; avaliações, orientações ou anotações adicionais não podem criar páginas vazias na linha do tempo.

## Verificação responsiva

Validar visualmente nos cenários definidos pela issue de layout:

- 1440 × 900: conteúdo fluido, painéis auxiliares laterais e ausência de `max-width` global excessivamente restritivo;
- 1366 × 768: título, contexto principal e ação prioritária no primeiro viewport;
- 1024 × 768: redução ordenada de colunas, sem controles comprimidos, sobreposição ou ações perdidas;
- 390 × 844: navegação lateral recolhida, subnavegação horizontal rolável, formulários em uma coluna, sem corte ou rolagem horizontal.

Em todos os tamanhos, validar sidebar expandida e recolhida, ordem de foco, textos extremos, estados locais de loading/erro/vazio e quebra legível de nomes, mensagens e erros longos. O foco programático da área principal deve usar `preventScroll` para não posicionar o título sob o cabeçalho fixo.

## Evidência visual automatizada

O workflow `Professional workspace visual evidence` deve renderizar, no head exato da pull request, as superfícies agregadas e o workspace individual real em rotas canônicas. Para a issue #880, o artefato precisa incluir resumo, avaliação, metas, orientações, anotações e histórico, além dos estados pausado, encerrado, carregando e erro recuperável.

A rota `/professional/patients/:patientId/goals` deve ser capturada em acompanhamento ativo e pausado nos viewports 1440 × 900, 1366 × 768, 1024 × 768 e 390 × 844. O cenário cria uma exceção por dia antes da captura e, no estado pausado, preserva essa exceção durante a transição para provar que inputs, selects, remoção, ativação e retry de notificação ficam bloqueados. As asserções também verificam labels acessíveis, contenção dos controles e ausência de overflow horizontal.

As capturas obrigatórias cobrem 1440 × 900, 1366 × 768, 1024 × 768, 390 × 844 e 390 × 1200. O manifesto do artefato individual registra separadamente `head_sha` e `checkout_sha`, porque o checkout de eventos `pull_request` pode usar o merge preview. As asserções de DOM verificam ausência de overflow horizontal da página, contenção da subnavegação e rolagem horizontal da subnav no mobile.

O harness usa `ProfessionalAreaPage`, `ProfessionalLayout` e `ProfessionalPatientWorkspace` reais, substituindo somente autenticação e transporte tRPC por fixtures determinísticas. Os estados ativo e pausado fornecem o mesmo `authorizationId`, reproduzindo um único ciclo de acompanhamento; o estado encerrado respeita o contrato público mínimo sem esse identificador. Ele comprova composição, responsividade e estados visuais; autorização, persistência e contratos de backend permanecem cobertos pelos gates funcionais próprios.

## Regressão manual mínima

1. Abrir diretamente cada rota individual e confirmar paciente e seção corretos.
2. Trocar entre dois pacientes e confirmar que nenhum dado do anterior permanece visível.
3. Revogar acesso com a tela aberta e confirmar limpeza e redirecionamento.
4. Com o workspace aberto, revogar o vínculo em outra sessão e confirmar que o evento SSE remove conteúdo e cache sem clique, foco ou nova mutation do profissional; repetir por query e mutation como defesa em profundidade.
5. Provocar uma resposta tardia do paciente anterior e confirmar que o paciente atual permanece aberto.
6. Revogar o entitlement da rota e confirmar que o erro `FORBIDDEN` limpa o contexto atual.
7. Remover somente alertas operacionais ou IA e confirmar que o paciente e o conteúdo principal da rota permanecem abertos.
8. Abrir relatório individual somente com `professional_reports` e conversa individual somente com `professional_messages`; nenhuma consulta `professionalRecord.get` pode ser disparada como dependência indireta, e o timezone deve ser resolvido sem exigir carteira.
9. Abrir rota com ID inválido, zero e número inseguro; nenhuma consulta individual deve ocorrer.
10. Filtrar a carteira, recarregar a página e confirmar restauração pelos parâmetros da URL.
11. Criar solicitação de acesso por e-mail ou celular e conferir estado pendente.
12. Criar rascunho, cancelar a navegação e confirmar sua preservação; repetir confirmando descarte e verificar que o formulário retorna vazio ao voltar, inclusive em subnav, sidebar e voltar/avançar.
13. Trocar de paciente com rascunho e confirmar que o novo paciente nunca recebe os campos do anterior.
14. Pausar e encerrar acompanhamento e conferir os bloqueios de avaliação, orientação, anotação e mensagem.
15. Conferir que relatórios agregados não exigem carteira e que relatórios individuais não exigem prontuário.
16. Conferir que mensagens agregadas e individuais usam apenas `professional_messages`.
17. Conferir estados de loading, vazio, erro recuperável e acesso indisponível em cada superfície principal.
18. Conferir autoria e data nas versões de avaliação, orientações e anotações privadas.
19. Conferir que a linha do tempo apresenta rótulos de domínio legíveis e nunca expõe o identificador técnico cru de um evento desconhecido.
20. Abrir Metas em acompanhamento ativo, criar uma exceção e confirmar que a ação principal pode ser habilitada; em seguida pausar o acompanhamento sem desmontar a rota e confirmar que todos os controles mutáveis, inclusive a exceção e o retry de notificação, ficam desabilitados.
21. Avançar avaliações para a página 2, alternar por anotações, relatório e mensagens e retornar à avaliação; a página 2 deve permanecer associada ao mesmo `authorizationId`/`patientId`.
22. Com um paciente já validado e visível, iniciar refetch de perfil e contexto, inclusive por foco e intervalo; cabeçalho, workspace e paginação devem permanecer montados. Repetir com erro transitório para confirmar aviso recuperável e com `FORBIDDEN` para confirmar limpeza imediata.

## Cabeçalho contextual

A última atividade do cabeçalho vem do primeiro evento da timeline canônica já ordenada pelo backend, nunca da próxima revisão. O fallback `Não informado` é usado somente sem atividade.

## Proteção completa das saídas com rascunho — issue #880

- Toda saída visível do workspace, incluindo **Minha alimentação**, subnavegação, navegação principal, retorno à carteira e troca de paciente, participa do mesmo contrato de proteção de rascunho.
- A confirmação ocorre no máximo uma vez por tentativa de navegação. Uma confirmação já aceita pelo interceptor é reutilizada pelo handler da mesma transição.
- Cancelar preserva rota, paciente e campos montados; confirmar o descarte limpa somente os campos não salvos e permite a navegação. Se paciente e autorização não mudarem, o workspace permanece montado e conserva paginações; após salvar, não há diálogo.
- Os testes unitários verificam cliques e eventos `navigate` canceláveis. O gate visual executa `history.back()` e `history.forward()` no Chromium real com um formulário controlado preenchido: cancelar deve manter a URL e o valor; confirmar deve alcançar o destino, desmontar o formulário e eliminar o rascunho.
