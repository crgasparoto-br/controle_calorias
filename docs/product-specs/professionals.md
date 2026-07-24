# Especificação de produto: profissionais

## Objetivo

Evoluir a capacidade profissional existente para uma Área Profissional completa, separada da navegação pessoal e integrada aos mesmos dados de domínio, permitindo que nutricionistas com atendimento individual administrem todo o acompanhamento dos seus pacientes.

Esta especificação complementa `product-experience-model.md`, que define o posicionamento do produto, as duas áreas de experiência e a separação dos fluxos de trabalho.

## Posicionamento aprovado

- O principal cliente pagante é o profissional.
- O público profissional inicial é o nutricionista com atendimento individual.
- O principal problema resolvido é a gestão e o acompanhamento dos pacientes.
- O nutricionista define metas e orientações durante o acompanhamento.
- O sistema deve administrar o acompanhamento completo, não apenas complementar a consulta.
- O Controle de Calorias é uma ferramenta que o nutricionista oferece aos pacientes.
- O paciente também pode utilizar o sistema sem vínculo profissional.
- O WhatsApp deve atender registros do paciente e comunicação profissional.
- Autorizações por WhatsApp usam botões `Autorizar`/`Recusar` com callback opaco; assinatura, usuário, telefone ativo, tipo, ação, expiração e consumo único são validados antes de aplicar a decisão. O fallback textual resolve a mesma pendência persistida.

## Estado atual a preservar

O repositório já possui uma primeira capacidade profissional baseada em:

- perfil profissional adicional à conta pessoal;
- solicitação, aprovação, rejeição e revogação de acesso;
- uma tela profissional concentrada em abas;
- visualização autorizada de dados do paciente;
- comentários;
- sugestões de metas e refeições;
- perguntas com IA sobre uma pessoa acompanhada;
- rastreabilidade básica por profissional e paciente.

Essa capacidade é a linha de base funcional. A evolução não deve removê-la, quebrar vínculos existentes ou exigir migração manual dos pacientes. A tela única com abas não é a arquitetura de experiência alvo.

Dados profissionais críticos não devem continuar apenas em memória ou em formatos inadequados para múltiplas instâncias. Prontuário, orientações, mensagens, alertas e auditoria dependem de persistência canônica e migração segura.

## Modelo de conta e navegação

- Todo profissional também é um usuário comum do sistema.
- O perfil profissional é uma camada adicional da conta pessoal, não um tipo separado de conta.
- A definição e ativação do perfil profissional permanece em Configurações até existir onboarding profissional específico.
- Usuário com perfil profissional ativo deve poder alternar explicitamente entre **Minha alimentação** e **Área profissional**.
- Usuário sem perfil profissional ativo não deve visualizar menu, rotas ou ações profissionais.
- Rotas e APIs profissionais devem validar perfil ativo e autorização no backend.
- A Área Profissional não deve acessar dados simulando login, sessão ou impersonação do paciente.
- Toda operação deve identificar separadamente o profissional ator e o paciente dono dos dados.

## Critérios de aceite do modelo de conta e navegação

- Usuário comum mantém acesso a Hoje, Registrar refeição, Refeições registradas, Relatórios, Metas, Integrações e Configurações.
- Usuário comum sem perfil profissional ativo não visualiza o menu Profissional.
- Rota e APIs do módulo Profissional bloqueiam operações quando o perfil profissional não está ativo.
- O estado de modo profissional ativo permanece consistente após recarregar a aplicação e iniciar uma nova sessão.
- Solicitação, aprovação e revogação passam por procedimentos protegidos.
- Solicitações pendentes continuam visíveis para o profissional e para a pessoa acompanhada após recarregar a aplicação ou iniciar nova sessão.
- Antes do consentimento, a resposta à solicitação não confirma se o e-mail ou celular pertence a uma conta. Pessoa existente, inexistente e auto-vínculo recebem o mesmo comprovante opaco `pending`; input inválido, perfil inativo, entitlement ausente e indisponibilidade não são reconhecidos como solicitação aceita.
- Na visão do profissional, vínculo pendente é representado por comprovante genérico sem nome, e-mail, telefone, `patientUserId`, objeto de paciente ou detalhe de entrega. Recusados e revogados permanecem localizáveis apenas pelo estado administrativo e identificador opaco.
- `requestAccess`, `myAccesses`, `portfolio` e `history` aplicam a mesma fronteira de minimização. Busca identificável por nome, e-mail ou ID só alcança vínculos aprovados.
- Aprovação e revogação atualizam o status do vínculo nos dois lados do acompanhamento; a reconciliação legada usa a versão do próprio vínculo e nunca permite que uma cópia antiga reative uma autorização revogada.
- Perfil, solicitações, vínculos e situação do acompanhamento permanecem consistentes após restart e entre instâncias.
- Transições de acompanhamento são gravadas em `professionalPatientTrackingEvents`; a linha do tempo exibida pela Área Profissional é lida de `professionalHistoryEvents`. Ambas preservam ator e data e sobrevivem a restart e múltiplas instâncias.
- Dashboard profissional respeita vínculo aprovado.
- Comentários são persistidos em `professionalComments`, permanecem internos ao profissional que os criou e não expõem dados de outro vínculo.
- Solicitação por e-mail ou celular encontra a pessoa correta ou registra um comprovante neutro sem revelar o resultado da resolução ao profissional antes do consentimento.
- Aprovações e revogações recebidas pela pessoa acompanhada ficam acessíveis em Configurações.
- Dados autorizados incluem visão equivalente a Hoje e Relatórios, além das metas nutricionais atuais.
- O profissional consegue registrar uma sugestão de ajuste de meta para pessoa autorizada.
- Sugestões de meta são persistidas, registram status e versão, permanecem disponíveis após restart e usam reserva persistente da decisão para impedir efeitos duplicados entre instâncias; retry do mesmo resultado é idempotente e estados finais não regridem.
- A meta ativa da pessoa acompanhada não é alterada pela criação de uma sugestão profissional.
- O profissional consegue registrar uma sugestão de refeição ou plano alimentar para pessoa autorizada.
- Sugestões de refeição são persistidas, registram status e versão e permanecem disponíveis após restart e entre instâncias.
- O diário de refeições da pessoa acompanhada não é alterado pela criação de uma sugestão profissional.
- O profissional consegue fazer perguntas com IA sobre uma pessoa autorizada.
- A resposta com IA apresenta contexto citado e aviso educacional.
- Perguntas com IA sobre pessoa sem acesso aprovado são bloqueadas.
- Histórico, comentários e sugestões retornam no máximo 100 itens por consulta pública atual, em ordem estável decrescente; o repository suporta cursor para evolução da interface sem carregar listas ilimitadas.
- Conteúdo que existia somente em arrays de processo antes da migration `0027_professional_content_persistence.sql` não é recuperável; a única fonte legada migrável nesta etapa é `patient_professional_goal_suggestions_v1`.
- Em produção, indisponibilidade do banco bloqueia novas leituras e mutações profissionais com erro sanitizado; não há fallback volátil como fonte de verdade.
- A exclusão de uma conta não é bloqueada por referências de autoria: eventos preservam o histórico com ator nulo após a remoção do titular.
- A interface deixa claro quando os dados exibidos pertencem à pessoa selecionada, e não à conta pessoal do profissional.

## Estrutura alvo da Área Profissional

### Início

Painel operacional com:

- pacientes que precisam de atenção;
- pacientes sem registros recentes;
- mensagens e solicitações pendentes;
- metas próximas de revisão;
- pesagens ou retornos pendentes;
- alertas relevantes;
- resumo da carteira.

### Pacientes

Gestão da carteira com:

- busca e filtros;
- pacientes ativos, pausados e encerrados;
- convites e solicitações pendentes;
- última atividade e última interação;
- situação do acompanhamento;
- próxima revisão;
- indicadores resumidos de adesão.

A carteira inicial consulta vínculos identificáveis de forma paginada, com ordenação estável por nome, e-mail ou identificador do paciente, seguida pela data da solicitação e pelo identificador do vínculo. Busca, autorização, situação do acompanhamento e atividade alimentar podem ser combinadas sem carregar relatórios completos. Autorização e acompanhamento são sempre apresentados separadamente.

Vínculos pendentes não participam da paginação identificável. Eles aparecem em uma lista de comprovantes opacos, com o rótulo **Solicitação aguardando confirmação**, e são deduplicados pelo vínculo canônico quando aplicável. Tentativas ainda não resolvidas expiram dessa lista após trinta dias. Esse mecanismo não cria cadastro de paciente nem autorização paralela.

Na primeira versão, “sem atividade recente” significa ausência de refeição confirmada nos três dias anteriores. Ausência de dado é apresentada como “não informado”, nunca como zero. Próxima revisão e pesagem só passam a compor a carteira quando suas entidades canônicas forem entregues pelas fases de prontuário e pendências.

Solicitações pendentes permanecem visíveis sem permitir abrir dados do paciente. Autorizações recusadas ou revogadas podem ser localizadas para fins operacionais, sem conceder acesso ao contexto nem retornar identidade ou dados pessoais adicionais. Somente após autorização `approved` nome, e-mail, identificador do paciente, acompanhamento, atividade e revisão podem compor a carteira.

### Prontuário de acompanhamento

Ao selecionar um paciente, o profissional entra em contexto dedicado e claramente identificado, contendo progressivamente:

- resumo atual;
- avaliação inicial;
- metas atuais e histórico;
- registros alimentares;
- peso, exercícios e evolução;
- relatórios individuais;
- orientações profissionais;
- anotações privadas;
- mensagens;
- alertas e pendências;
- histórico do vínculo e do acompanhamento.

Abas podem ser usadas dentro do prontuário de um paciente. Elas não devem continuar sendo a única estrutura de todo o módulo profissional.

### Acompanhamento

Central para priorização baseada em regras objetivas e explicáveis. Alertas apoiam o profissional e não representam diagnóstico automático.

### Mensagens

Comunicação individual por web e WhatsApp, com origem explícita:

- automática;
- sugerida pela IA;
- enviada pelo nutricionista.

### Relatórios

- evolução individual;
- adesão e frequência de registros;
- comparação entre períodos;
- indicadores nutricionais disponíveis;
- visão da carteira;
- pacientes que precisam de revisão.

A primeira versão da página de Relatórios separa a visão agregada da carteira do relatório individual. A visão agregada reutiliza a consulta paginada da carteira e as pendências operacionais, sem carregar bundles nutricionais para cada paciente. O período agregado é configurável em até 90 dias; refeições são limitadas por uma janela UTC indexável e classificadas no calendário local do timezone efetivo de cada paciente. O relatório individual exige seleção explícita de uma pessoa com autorização vigente e usa `patientPeriodBundle`, o timezone efetivo do paciente e os mesmos componentes e contratos canônicos de Relatórios da Área do Paciente. Mudanças de pessoa ou período usam chaves de consulta distintas; revogação remove o contexto profissional e impede novas leituras. Aderência, metas planejadas e frequência de registros são produzidas no bundle canônico do backend; o frontend profissional apenas adapta esses contratos para exibição.

### Configurações profissionais

- dados e identificação profissional;
- modelos de mensagem;
- critérios configuráveis de alerta;
- preferências de acompanhamento;
- plano, limites e cobrança quando implementados.
