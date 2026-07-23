# Navegação da Área Profissional

## Objetivo

A Área Profissional possui um shell próprio, separado da Área do Paciente, sem duplicar identidade, sessão ou dados. O usuário com perfil profissional ativo alterna explicitamente entre **Minha alimentação** e **Área Profissional**.

## Rotas canônicas

- `/professional`: início profissional;
- `/professional/patients`: carteira de pacientes;
- `/professional/patients/:patientId`: prontuário e resumo individual;
- `/professional/patients/:patientId/assessment`: avaliação;
- `/professional/patients/:patientId/goals`: metas;
- `/professional/patients/:patientId/guidance`: orientações;
- `/professional/patients/:patientId/notes`: anotações;
- `/professional/patients/:patientId/history`: histórico;
- `/professional/patients/:patientId/reports`: relatório individual;
- `/professional/patients/:patientId/messages`: conversa individual;
- `/professional/messages`: mensagens da carteira;
- `/professional/reports`: relatórios agregados;
- `/professional/settings`: configurações profissionais.

`/professional/follow-up` não é mais destino funcional e redireciona para `/professional/patients`. `/professional/legacy` redireciona somente para `/professional`.

Cada capacidade profissional usa composição própria e não importa páginas pessoais para simular acesso ao paciente.

## Carteira e painel inicial

`nutrition.professionals.portfolio` recebe busca, filtros e paginação e deriva sempre o `professionalUserId` da sessão autenticada. A consulta retorna identificação mínima, autorização, situação do acompanhamento, última refeição confirmada e última interação profissional. O painel consome agregados canônicos e não executa um relatório por paciente.

A rota agregada de relatórios usa `professionalRecord.portfolioReport`, protegida por `professional_reports`, e recebe somente o resumo necessário. Ela não devolve a lista da carteira nem exige `professional_portfolio` como dependência indireta.

A ordenação da carteira é estável por identificação exibível, solicitação decrescente e ID do vínculo. A paginação inicial usa página e limite entre 10 e 50 registros. Todas as consultas SQL, inclusive totais, incluem o profissional autenticado. Vínculo pendente, rejeitado ou revogado nunca habilita **Abrir paciente**.

## Autorização e isolamento

- O menu da Área do Paciente só apresenta a entrada profissional quando `professionalProfileActive` está ativo.
- O shell consulta o perfil profissional canônico antes de exibir o conteúdo e diferencia carregamento, sessão ausente, perfil inativo e falha de validação.
- A URL é a única fonte de verdade do paciente e da seção ativa. `selectedPatient` é apenas projeção derivada da rota depois da revalidação.
- `professionalRecord.context` recebe o `patientId` e o recurso exato da rota, revalidando perfil ativo, entitlement e autorização `approved`.
- Prontuário, avaliação, metas, orientações, anotações e histórico usam `professional_record`; relatórios usam `professional_reports`; mensagens usam `professional_messages`.
- APIs e operações `patient-scoped` continuam obrigadas a validar perfil, vínculo, consentimento e entitlement no backend; a proteção visual não substitui autorização.
- Perfil e contexto do paciente são revalidados periodicamente e quando a janela recupera o foco.
- Na troca de paciente, saída para **Minha alimentação**, perda de autorização, perda do perfil ou desmontagem do shell, consultas individuais são canceladas e removidas do cache antes de outro paciente ficar visível.
- Erros de query ou mutation que informem revogação removem imediatamente o contexto e os dados visíveis e retornam com segurança à carteira.
- Falha temporária mantém o contexto protegido, sem dados antigos, e oferece **Tentar novamente**.
- ID malformado, zero ou número inseguro não dispara consulta com identificador artificial.

## Acessibilidade e responsividade

- A navegação possui landmark e rótulo próprios.
- A rota ativa usa `aria-current="page"`.
- O controle da barra lateral possui nome acessível e continua disponível no comportamento responsivo do componente de sidebar.
- Mudanças de rota atualizam o título do documento e movem o foco programaticamente para o conteúdo principal com `preventScroll`.
- O contexto do paciente usa região viva para anunciar alterações sem depender apenas de cor ou posição visual.
- A subnavegação individual é rolável horizontalmente quando necessário e preserva ações e nomes acessíveis.

## Migração e compatibilidade

Bookmarks antigos continuam seguros somente como redirects:

- `/professional/follow-up` → `/professional/patients`;
- `/professional/legacy` → `/professional`.

Nenhum redirect depende de paciente salvo em memória, e nenhum dos caminhos antigos mantém uma experiência funcional paralela.

## Validação

Os testes cobrem:

- matcher de rotas e colisão entre coleção e contexto individual;
- entitlement exato de prontuário, metas, relatórios e mensagens, inclusive cenários discriminantes sem recursos vizinhos;
- IDs válidos, malformados, zero e números inseguros;
- bloqueio de perfil inativo e falha temporária de validação;
- revalidação ao recuperar foco;
- troca entre pacientes com cancelamento e remoção dos dados anteriores;
- navegação rápida voltar/avançar sem aplicar transição tardia;
- revogação detectada por query e mutation com limpeza imediata;
- limpeza do contexto ao voltar para a experiência pessoal;
- redirects de `/professional/follow-up` e `/professional/legacy`;
- navegação por teclado, rota ativa, título do documento e controle responsivo.
