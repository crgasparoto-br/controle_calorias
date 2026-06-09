# Especificação de produto: profissionais

## Objetivo

Permitir que profissionais acompanhem pacientes mediante solicitação, aprovação e histórico auditável de interações.

## Regras de produto

- Todo nutricionista também é um usuário comum do sistema.
- O perfil profissional de nutricionista é uma camada adicional da conta pessoal, não um tipo de conta separado.
- A definição e ativação do perfil profissional deve ficar em Configurações.
- O menu e a rota Nutricionista só devem ficar disponíveis para usuários com perfil profissional ativo.
- As APIs profissionais também devem validar perfil profissional ativo, não apenas depender da visibilidade do menu.
- Acesso profissional exige solicitação e aprovação do paciente.
- A solicitação pode usar e-mail ou celular do paciente como identificador de entrada no fluxo web.
- As solicitações recebidas pelo paciente devem aparecer em Configurações, junto dos vínculos pessoais do usuário.
- Profissional só pode ver dashboard, histórico, metas nutricionais e dados autorizados do paciente.
- A visão do paciente no módulo Nutricionista deve separar contexto profissional em áreas como Resumo, Hoje, Relatórios, Metas e Comentários.
- Comentários e sugestões de meta devem ser rastreáveis por profissional e paciente.
- Revogação deve bloquear novos acessos imediatamente.
- O controle de consentimento é operacional e não deve aparecer como bloco visual destacado na tela principal do Nutricionista.

## Critérios de aceite

- Usuário comum mantém acesso a Hoje, Registrar refeição, Refeições registradas, Relatórios, Metas, Integrações e Configurações.
- Usuário comum sem perfil profissional ativo não visualiza o menu Nutricionista.
- Rota e APIs do módulo Nutricionista bloqueiam operações quando o perfil profissional não está ativo.
- Solicitação, aprovação e revogação passam por procedimentos protegidos.
- Dashboard profissional respeita vínculo aprovado.
- Comentários não expõem dados de outros pacientes.
- Solicitação por e-mail ou celular encontra o paciente correto ou retorna erro amigável.
- Aprovações e revogações recebidas pelo paciente ficam acessíveis em Configurações.
- Dados do paciente autorizado incluem visão equivalente a Hoje e Relatórios, além das metas nutricionais atuais.
- A interface deixa claro quando os dados exibidos pertencem ao paciente selecionado, e não à conta pessoal do nutricionista.

## Fora de escopo atual

- Transformar nutricionista em tipo separado de conta.
- Cobrança ou assinatura profissional.
- Perguntas com IA sobre pacientes.
- Geração completa de dieta automatizada.
