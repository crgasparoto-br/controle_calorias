# Especificação de produto: profissionais

## Objetivo

Permitir que profissionais acompanhem pessoas mediante solicitação, aprovação e histórico auditável de interações.

## Regras de produto

- Todo profissional também é um usuário comum do sistema.
- O perfil profissional é uma camada adicional da conta pessoal, não um tipo de conta separado.
- A definição e ativação do perfil profissional deve ficar em Configurações.
- O menu e a rota Profissional só devem ficar disponíveis para usuários com perfil profissional ativo.
- As APIs profissionais também devem validar perfil profissional ativo, não apenas depender da visibilidade do menu.
- Acesso profissional exige solicitação e aprovação da pessoa acompanhada.
- A solicitação pode usar e-mail ou celular da pessoa acompanhada como identificador de entrada no fluxo web.
- As solicitações recebidas pela pessoa acompanhada devem aparecer em Configurações, junto dos vínculos pessoais do usuário.
- Profissional só pode ver dashboard, histórico, metas nutricionais e dados autorizados da pessoa acompanhada.
- A visão da pessoa acompanhada no módulo Profissional deve separar contexto profissional em áreas como Resumo, Hoje, Relatórios, Metas, Sugestões, Comentários e IA.
- Comentários, sugestões de meta, sugestões de refeição e perguntas com IA devem ser rastreáveis por profissional e pessoa acompanhada.
- Sugestões de meta podem iniciar em rascunho ou enviada e devem preservar status para fluxo futuro de aceite, recusa ou cancelamento.
- Sugestões de refeição ou plano alimentar podem iniciar em rascunho ou enviada e devem preservar status para fluxo futuro de aceite, recusa ou cancelamento.
- Perguntas com IA sobre pessoas acompanhadas só podem usar dados autorizados e devem retornar uma resposta de apoio educacional com contexto citado.
- Respostas com IA para profissionais não substituem avaliação clínica, diagnóstico, prescrição ou conduta profissional.
- A criação de sugestão de meta pelo profissional não altera automaticamente a meta ativa da pessoa acompanhada.
- A criação de sugestão de refeição pelo profissional não cria automaticamente refeição no diário da pessoa acompanhada.
- Perguntas com IA não alteram metas, refeições, comentários ou dados automaticamente.
- Revogação deve bloquear novos acessos imediatamente.
- O controle de consentimento é operacional e não deve aparecer como bloco visual destacado na tela principal Profissional.

## Critérios de aceite

- Usuário comum mantém acesso a Hoje, Registrar refeição, Refeições registradas, Relatórios, Metas, Integrações e Configurações.
- Usuário comum sem perfil profissional ativo não visualiza o menu Profissional.
- Rota e APIs do módulo Profissional bloqueiam operações quando o perfil profissional não está ativo.
- O estado de modo profissional ativo permanece consistente após recarregar a aplicação e iniciar uma nova sessão.
- Solicitação, aprovação e revogação passam por procedimentos protegidos.
- Dashboard profissional respeita vínculo aprovado.
- Comentários não expõem dados de outras pessoas acompanhadas.
- Solicitação por e-mail ou celular encontra a pessoa correta ou retorna erro amigável.
- Aprovações e revogações recebidas pela pessoa acompanhada ficam acessíveis em Configurações.
- Dados autorizados incluem visão equivalente a Hoje e Relatórios, além das metas nutricionais atuais.
- O profissional consegue registrar uma sugestão de ajuste de meta para pessoa autorizada.
- Sugestões de meta registram status e ficam disponíveis na análise profissional da pessoa acompanhada.
- A meta ativa da pessoa acompanhada não é alterada pela criação de uma sugestão profissional.
- O profissional consegue registrar uma sugestão de refeição ou plano alimentar para pessoa autorizada.
- Sugestões de refeição registram status e ficam disponíveis na análise profissional da pessoa acompanhada.
- O diário de refeições da pessoa acompanhada não é alterado pela criação de uma sugestão profissional.
- O profissional consegue fazer perguntas com IA sobre uma pessoa autorizada.
- A resposta com IA apresenta contexto citado e aviso educacional.
- Perguntas com IA sobre pessoa sem acesso aprovado são bloqueadas.
- A interface deixa claro quando os dados exibidos pertencem à pessoa selecionada, e não à conta pessoal do profissional.

## Fora de escopo atual

- Transformar profissional em tipo separado de conta.
- Cobrança ou assinatura profissional.
- Diagnóstico, prescrição clínica ou decisão automatizada por IA.
- Geração completa de dieta automatizada.
- Aplicação automática de sugestão de meta na meta ativa da pessoa acompanhada.
- Criação automática de refeições no diário da pessoa acompanhada a partir de sugestão profissional.
- Tela de aceite ou recusa da sugestão pela pessoa acompanhada.
