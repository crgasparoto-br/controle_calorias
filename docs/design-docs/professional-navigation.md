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
- O shell profissional também bloqueia o conteúdo quando não existe sessão ou quando o perfil deixa de estar ativo.
- O perfil é revalidado a cada 30 segundos e quando a janela recupera o foco, reduzindo a permanência de dados visíveis após perda de acesso.
- APIs e operações `patient-scoped` continuam obrigadas a validar perfil, vínculo, consentimento e permissão no backend; a proteção visual não substitui autorização.
- O paciente selecionado pertence ao contexto local do shell e é descartado ao sair da Área Profissional.

## Migração e compatibilidade

A rota `/professional/legacy` mantém as funções existentes enquanto carteira, prontuário, mensagens, relatórios e configurações ganham substituições validadas. A experiência legada só poderá ser removida pelo gate final da épica, depois de todas as capacidades úteis terem equivalente aprovado.

## Validação

Os testes cobrem:

- bloqueio de perfil inativo;
- remoção do conteúdo visível após perda de acesso;
- revalidação ao recuperar foco;
- alternância para a Área do Paciente sem novo login;
- carregamento direto de rota profissional pelo roteador real;
- preservação da rota legada.
