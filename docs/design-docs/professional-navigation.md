# Navegação da Área Profissional

## Objetivo

A Área Profissional possui um shell próprio, separado da Área do Paciente, sem duplicar identidade, sessão ou dados. O usuário com perfil profissional ativo alterna explicitamente entre **Minha alimentação** e **Área Profissional**.

## Rotas iniciais

- `/professional`: início profissional;
- `/professional/patients`: carteira de pacientes;
- `/professional/follow-up`: acompanhamento;
- `/professional/messages`: mensagens;
- `/professional/reports`: relatórios profissionais;
- `/professional/settings`: configurações profissionais;
- `/professional/legacy`: experiência profissional anterior, preservada durante a migração incremental.

As rotas funcionais novas começam como pontos de extensão independentes. Cada capacidade será incorporada pelas subissues da épica #803 sem importar páginas pessoais para simular acesso ao paciente.

## Autorização e isolamento

- O menu da Área do Paciente só apresenta a entrada profissional quando `professionalProfileActive` está ativo.
- O shell consulta o perfil profissional canônico no backend antes de exibir o conteúdo e diferencia carregamento, sessão ausente, perfil inativo e falha de validação.
- Perfil e vínculos são revalidados a cada 30 segundos e quando a janela recupera o foco.
- APIs e operações `patient-scoped` continuam obrigadas a validar perfil, vínculo, consentimento e permissão no backend; a proteção visual não substitui autorização.
- O paciente selecionado pertence ao contexto local do shell.
- Na troca de paciente, saída para **Minha alimentação**, abertura da experiência legada, perda do perfil ou desmontagem do shell, o paciente anterior é removido e as consultas patient-scoped são invalidadas.
- Quando um vínculo deixa de estar `approved`, o shell remove imediatamente o paciente do contexto visível e invalida os dados associados.
- Se não for possível revalidar a autorização de um paciente selecionado, o conteúdo patient-scoped fica oculto até nova validação bem-sucedida.

## Acessibilidade e responsividade

- A navegação possui landmark e rótulo próprios.
- A rota ativa usa `aria-current="page"`.
- O controle da barra lateral possui nome acessível e continua disponível no comportamento responsivo do componente de sidebar.
- Mudanças de rota atualizam o título do documento e movem o foco programaticamente para o conteúdo principal.
- O contexto do paciente usa região viva para anunciar alterações sem depender apenas de cor ou posição visual.

## Migração e compatibilidade

A rota `/professional/legacy` mantém as funções existentes enquanto carteira, prontuário, mensagens, relatórios e configurações ganham substituições validadas. A experiência legada só poderá ser removida pelo gate final da épica, depois de todas as capacidades úteis terem equivalente aprovado.

## Validação

Os testes cobrem:

- bloqueio de perfil inativo e falha de validação do backend;
- revalidação de perfil e vínculos ao recuperar foco;
- troca entre pacientes com invalidação dos dados anteriores;
- revogação de vínculo com a página aberta;
- limpeza do contexto ao voltar para a experiência pessoal;
- navegação por teclado, rota ativa e título do documento;
- controle responsivo e landmarks acessíveis;
- carregamento direto de rota profissional pelo roteador real;
- preservação da rota legada.
