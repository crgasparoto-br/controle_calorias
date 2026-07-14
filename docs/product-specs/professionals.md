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

Essa capacidade é a linha de base funcional. A evolução não deve removê-la, quebrar vínculos existentes ou exigir migração manual dos pacientes. A tela única com abas não é, porém, a arquitetura de experiência alvo.

## Modelo de conta e navegação

- Todo profissional também é um usuário comum do sistema.
- O perfil profissional é uma camada adicional da conta pessoal, não um tipo separado de conta.
- A definição e ativação do perfil profissional permanece em Configurações até existir fluxo de onboarding profissional específico.
- Usuário com perfil profissional ativo deve poder alternar explicitamente entre **Minha alimentação** e **Área profissional**.
- Usuário sem perfil profissional ativo não deve visualizar menu, rotas ou ações profissionais.
- Rotas e APIs profissionais devem validar perfil ativo e autorização no backend.
- A Área Profissional não deve acessar dados simulando login, sessão ou impersonação do paciente.

## Estrutura alvo da Área Profissional

A Área Profissional deve possuir navegação e páginas próprias. A implementação pode ser incremental, mas a direção de produto é:

### Início

Painel operacional do nutricionista com:

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

### Prontuário de acompanhamento

Ao selecionar um paciente, o profissional deve entrar em um contexto dedicado e claramente identificado, contendo progressivamente:

- resumo atual;
- avaliação inicial;
- metas atuais e histórico de alterações;
- registros alimentares;
- peso, exercícios e evolução;
- relatórios individuais;
- orientações profissionais;
- comentários e anotações privadas;
- mensagens;
- alertas e pendências;
- histórico do vínculo.

Abas podem ser usadas dentro do prontuário de um paciente. Elas não devem continuar sendo a única estrutura para todo o módulo profissional.

### Acompanhamento

Central para priorização de pacientes baseada em regras verificáveis, como:

- ausência de registros;
- baixa adesão;
- desvios recorrentes da meta;
- alteração relevante de peso;
- ingestão insuficiente de nutrientes monitorados;
- comportamento alimentar irregular;
- meta possivelmente desatualizada;
- registro que exige revisão.

Alertas devem apoiar o profissional e não representar diagnóstico automático.

### Mensagens

Comunicação individual por web e WhatsApp, incluindo:

- orientações;
- pedidos de pesagem ou registro;
- lembretes;
- revisão de metas;
- resumo de acompanhamento;
- mensagens preparadas pela IA e revisadas antes do envio.

A origem da mensagem deve ser explícita: automática, sugerida pela IA ou enviada pelo nutricionista.

### Relatórios

- evolução individual;
- adesão e frequência de registros;
- comparação entre períodos;
- indicadores nutricionais disponíveis;
- visão da carteira;
- pacientes que precisam de revisão.

### Configurações profissionais

- dados e identificação profissional;
- modelos de mensagem;
- critérios configuráveis de alerta;
- preferências de acompanhamento;
- plano, limites e cobrança quando implementados.

## Vínculo, consentimento e acesso

- Acesso profissional exige solicitação e aprovação do paciente.
- A solicitação pode usar e-mail ou celular como identificador de entrada no fluxo web.
- Solicitações e vínculos devem permanecer disponíveis após recarregar a aplicação, trocar de sessão ou reiniciar o servidor.
- Solicitações recebidas pelo paciente devem aparecer na sua área de configurações ou em central equivalente.
- O profissional só pode acessar dados explicitamente autorizados pelo vínculo vigente.
- Revogação, pausa incompatível com acesso ou encerramento devem bloquear novas consultas imediatamente.
- O histórico auditável do vínculo deve ser preservado.
- O paciente mantém seus próprios registros e histórico após o fim do acompanhamento.

## Metas e orientações

### Comportamento atual

- A criação de sugestão de meta não altera automaticamente a meta ativa.
- A criação de sugestão de refeição não cria automaticamente refeição no diário.
- Sugestões preservam status para aceite, recusa, cancelamento ou evolução futura do fluxo.

### Modelo alvo

O profissional deve poder definir e revisar metas oficiais e registrar orientações durante um vínculo ativo.

Essa evolução só pode substituir o comportamento de sugestão quando existir um fluxo explícito que:

- valide vínculo e permissão;
- registre o profissional responsável;
- preserve valor anterior e novo valor;
- registre vigência e justificativa quando aplicável;
- notifique o paciente;
- mantenha histórico consultável;
- preserve compatibilidade com metas pessoais e com o encerramento do vínculo;
- defina o que ocorre quando paciente e profissional propõem valores conflitantes.

Até esse fluxo ser implementado e testado, o comportamento atual de sugestão deve permanecer.

## IA para o profissional

A IA pode:

- resumir períodos;
- comparar dias úteis e finais de semana;
- identificar fatores que contribuíram para desvios;
- localizar pacientes que precisam de atenção;
- preparar rascunhos de mensagens e orientações;
- responder perguntas usando somente dados autorizados e contexto citado.

A IA não pode:

- diagnosticar;
- prescrever conduta clínica de forma autônoma;
- alterar metas, refeições, comentários ou dados automaticamente;
- acessar dados de paciente sem vínculo aprovado;
- ocultar os dados de origem usados no resumo quando a conferência for necessária.

## WhatsApp profissional

- O paciente continua usando o WhatsApp para registros e consultas pessoais.
- O profissional pode usar o sistema para enviar mensagens de acompanhamento pelo canal aprovado.
- Autorização profissional, identidade do remetente, consentimento e auditoria devem ser validados no backend.
- Padronização de transporte e formatação do WhatsApp pertence à plataforma compartilhada; fluxos exclusivos do nutricionista pertencem à Área Profissional.
- A implementação profissional deve reutilizar o contrato central de mensagens, não criar um transporte paralelo.

## Separação de escopo das issues

### Permanecem fora da épica profissional

- correções de Hoje, Registros, Relatórios, Metas e alimentos do usuário individual;
- padronização geral do WhatsApp;
- timezone e datas do dono dos dados;
- persistência, autenticação, privacidade e IA compartilhadas;
- billing, checkout e elegibilidade comercial;
- onboarding geral iniciado pelo WhatsApp.

Esses trabalhos podem ser dependências da Área Profissional, mas não devem ser incorporados ao seu escopo.

### Pertencem à épica profissional

- navegação e layout próprios;
- dashboard de carteira;
- lista e gestão de pacientes;
- prontuário;
- acompanhamento e alertas;
- metas oficiais e orientações profissionais;
- comunicação profissional;
- relatórios da carteira;
- configurações profissionais;
- apoio da IA no contexto do atendimento.

## Evolução incremental

1. Separar navegação profissional e organizar carteira/perfil resumido sem remover a tela atual antes da substituição segura.
2. Criar prontuário e histórico profissional sobre os contratos existentes.
3. Implementar metas oficiais, orientações e auditoria.
4. Implementar acompanhamento, alertas e comunicação profissional.
5. Implementar relatórios da carteira e apoio da IA.
6. Integrar plano e limites definidos pela épica de billing.

Cada etapa deve manter a Área do Paciente funcional e proteger a tela de Relatórios contra regressões.

## Critérios de aceite da direção de produto

- Usuário comum mantém acesso à experiência atual sem precisar de profissional.
- Usuário com perfil profissional pode acessar ambiente profissional separado da sua experiência pessoal.
- A conta pode acumular os dois contextos sem duplicação de identidade.
- Vínculos, autorizações e revogações permanecem protegidos e auditáveis.
- O paciente selecionado fica claramente identificado em toda página profissional.
- A Área Profissional não depende de impersonação.
- O desenvolvimento profissional reutiliza serviços de domínio e contratos compartilhados, sem importar ou duplicar páginas pessoais.
- Correções existentes não recebem funcionalidades profissionais fora do escopo original.
- Metas profissionais só passam a ser aplicadas diretamente após existir histórico, autorização, vigência e notificação.
- Comunicação profissional reutiliza a infraestrutura central do WhatsApp.
- O paciente mantém seus dados quando o vínculo termina.

## Fora de escopo atual

- transformar profissional em tipo separado de conta;
- exigir profissional para utilizar o sistema;
- clínicas com múltiplos profissionais e permissões de equipe;
- geração completa e automática de dieta;
- diagnóstico ou decisão clínica automatizada por IA;
- definir preços e limites dentro desta especificação;
- reescrever a Área do Paciente como parte da evolução profissional.

## Dependências e decisões abertas

Dependências:

- `product-experience-model.md` para posicionamento e separação dos fluxos;
- especificações de metas, relatórios, WhatsApp, privacidade e integrações;
- épica de billing para assinatura, limites e elegibilidade comercial.

Decisões ainda abertas:

- limites e preços por quantidade de pacientes;
- definição de paciente ativo;
- recursos incluídos para pacientes convidados;
- nível de configuração da experiência do paciente pelo nutricionista;
- regras futuras para assistentes e clínicas;
- política de cobrança por WhatsApp e uso elevado de IA.