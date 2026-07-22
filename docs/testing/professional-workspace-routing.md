# Área Profissional — rotas, segurança e regressão

## Rotas canônicas

| Superfície | Rota | Contexto |
| --- | --- | --- |
| Início profissional | `/professional` | agregado |
| Carteira | `/professional/patients` | agregado |
| Prontuário | `/professional/patients/:patientId` | paciente |
| Avaliação | `/professional/patients/:patientId/assessment` | paciente |
| Metas | `/professional/patients/:patientId/goals` | paciente |
| Orientações | `/professional/patients/:patientId/guidance` | paciente |
| Anotações | `/professional/patients/:patientId/notes` | paciente |
| Histórico | `/professional/patients/:patientId/history` | paciente |
| Relatório individual | `/professional/patients/:patientId/reports` | paciente |
| Conversa individual | `/professional/patients/:patientId/messages` | paciente |
| Mensagens da carteira | `/professional/messages` | agregado |
| Relatórios da carteira | `/professional/reports` | agregado |
| Configurações profissionais | `/professional/settings` | agregado |

`/professional/follow-up` é legado e redireciona para a carteira. O identificador do paciente deve ser inteiro positivo e seguro; valores inválidos não podem disparar consultas.

## Autorizações por superfície

- Carteira: `professional_portfolio`.
- Prontuário, avaliação, metas, orientações, anotações e histórico: `professional_record`.
- Relatório individual e agregado: `professional_reports`.
- Mensagens individuais e agregadas: `professional_messages`.
- Configurações: `professional_settings`.
- Início: `professional_dashboard`.

A URL é a única fonte de verdade para o paciente ativo. Nenhum seletor global ou estado React pode manter um paciente diferente da rota.

## Troca e revogação de paciente

Ao trocar de paciente, sair da rota individual, perder autorização ou desativar a Área Profissional:

1. cancelar consultas individuais em andamento;
2. remover do cache prontuário, timezone, dashboards, relatórios, alertas, mensagens e dados de IA individuais;
3. impedir a renderização de dados antigos enquanto a nova autorização é confirmada;
4. redirecionar para a carteira quando o acesso não estiver mais disponível;
5. preservar vínculos e histórico persistidos ao desativar a área, mas bloquear novas operações.

## Proteção de rascunho

Avaliação, orientação, anotação e mensagem devem pedir confirmação antes de trocar de rota, paciente, usar voltar/avançar ou fechar a página quando houver conteúdo não salvo.

## Verificação responsiva

Validar visualmente nos cenários definidos pela issue de layout:

- 1440 × 900: conteúdo fluido, painéis auxiliares laterais e ausência de `max-width` global excessivamente restritivo;
- 1366 × 768: título, contexto principal e ação prioritária no primeiro viewport;
- 1024 × 768: redução ordenada de colunas, sem controles comprimidos, sobreposição ou ações perdidas;
- 390 × 844: navegação lateral recolhida, subnavegação horizontal rolável, formulários em uma coluna, sem corte ou rolagem horizontal.

Em todos os tamanhos, validar sidebar expandida e recolhida, ordem de foco, textos extremos, estados locais de loading/erro/vazio e quebra legível de nomes, mensagens e erros longos. O foco programático da área principal deve usar `preventScroll` para não posicionar o título sob o cabeçalho fixo.

## Regressão manual mínima

1. Abrir diretamente cada rota individual e confirmar paciente e seção corretos.
2. Trocar entre dois pacientes e confirmar que nenhum dado do anterior permanece visível.
3. Revogar acesso com a tela aberta e confirmar limpeza e redirecionamento.
4. Abrir rota com ID inválido, zero e número inseguro; nenhuma consulta individual deve ocorrer.
5. Filtrar a carteira, recarregar a página e confirmar restauração pelos parâmetros da URL.
6. Criar solicitação de acesso por e-mail ou celular e conferir estado pendente.
7. Criar rascunho, tentar navegar e conferir a confirmação de descarte.
8. Pausar e encerrar acompanhamento e conferir os bloqueios de avaliação, orientação, anotação e mensagem.
9. Conferir que relatórios agregados não exigem paciente e que relatórios individuais usam o paciente da URL.
10. Conferir estados de loading, vazio, erro recuperável e acesso indisponível em cada superfície principal.
