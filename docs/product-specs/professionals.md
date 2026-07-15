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

### Configurações profissionais

- dados e identificação profissional;
- modelos de mensagem;
- critérios configuráveis de alerta;
- preferências de acompanhamento;
- plano, limites e cobrança quando implementados.

## Autorização e situação do acompanhamento

Autorização de dados e situação operacional do acompanhamento são domínios distintos.

### Autorização

Estados:

- `pending`;
- `approved`;
- `rejected`;
- `revoked`.

A revogação bloqueia imediatamente novas consultas e mutações profissionais, inclusive em páginas já abertas.

### Acompanhamento

Estados iniciais aprovados:

- **ativo:** acompanhamento em andamento;
- **pausado:** vínculo e histórico preservados, sem novas metas, orientações ou alertas;
- **encerrado:** acompanhamento finalizado, sem novas intervenções;
- revogação não é estado de acompanhamento, mas retirada da autorização.

| Situação | Consultar histórico autorizado | Alterar metas | Enviar orientação | Gerar alertas |
|---|---:|---:|---:|---:|
| Ativo | Sim | Sim | Sim | Sim |
| Pausado | Sim | Não | Apenas comunicação administrativa | Não |
| Encerrado | Apenas histórico profissional necessário para auditoria | Não | Não | Não |
| Autorização revogada | Não | Não | Não | Não |

Pausa, retomada e encerramento devem registrar ator, data e motivo quando informado. O encerramento não apaga dados do paciente nem histórico auditável.

## Anotações e orientações

### Anotação profissional

- conteúdo interno do nutricionista autor;
- não visível ao paciente;
- não enviada pelo WhatsApp;
- não compartilhada automaticamente com outro profissional;
- preservada conforme regras de auditoria e retenção.

### Orientação profissional

- conteúdo destinado ao paciente;
- visível na Área do Paciente;
- pode ser entregue pelo WhatsApp;
- registra autor, data, versão e situação de envio;
- não pode ser alterada silenciosamente após envio.

Uma anotação privada não é convertida diretamente em orientação. O profissional cria e revisa uma nova orientação baseada nela.

## Avaliação inicial

A primeira versão é uma avaliação nutricional operacional e versionada, não um prontuário médico completo.

Campos mínimos:

- objetivo do acompanhamento;
- peso e altura;
- rotina e horários habituais;
- atividade física;
- preferências alimentares;
- restrições e alergias;
- dificuldades relatadas;
- hábitos relevantes;
- observações do nutricionista;
- data da avaliação;
- próxima revisão planejada.

Nova avaliação não substitui silenciosamente a anterior. Medicamentos, diagnósticos, exames e dados clínicos ampliados ficam fora da primeira versão e exigem análise específica de necessidade, privacidade e responsabilidade profissional.

## Metas e orientações

### Comportamento atual

- Sugestão de meta não altera automaticamente a meta ativa.
- Sugestão de refeição não cria automaticamente refeição no diário.
- Sugestões preservam status para aceite, recusa, cancelamento ou evolução futura.
- Esse comportamento permanece até a aplicação direta de metas profissionais estar completa e testada.

### Modelo alvo aprovado

Durante acompanhamento ativo:

- a meta oficial é definida e revisada pelo nutricionista;
- o paciente visualiza a meta, origem e cálculo;
- o paciente pode solicitar revisão, mas não altera silenciosamente a meta profissional;
- alterações registram valor anterior, novo valor, autor, data, vigência e justificativa quando aplicável;
- exceções por dia e configuração sobre exercícios continuam no contrato canônico de metas;
- a origem da meta deve ser explícita: `personal`, `professional` ou `system_estimate`.

Precedência:

1. meta profissional vigente durante acompanhamento ativo;
2. meta pessoal vigente quando não existir meta profissional aplicável;
3. estimativa do sistema somente como proposta ou fallback permitido.

Ao encerrar ou revogar:

- a meta profissional permanece no histórico;
- o profissional deixa de poder alterá-la;
- o paciente pode adotá-la como meta pessoal ou definir outra;
- não existe controle permanente do profissional após o vínculo.

A subissue de metas deve decidir explicitamente o comportamento operacional da meta durante pausa e impedir duas metas profissionais ativas concorrentes.

## Alertas iniciais

A primeira versão usa somente sinais objetivos e explicáveis:

1. nenhum registro alimentar no período configurado, inicialmente sugerido em três dias;
2. solicitação de pesagem vencida;
3. revisão de meta alcançando a data prevista;
4. solicitação profissional sem resposta no prazo;
5. registro explicitamente marcado como necessitando revisão;
6. desvio recorrente da meta somente após definição de faixa, período e quantidade mínima de dias válidos.

Alertas sobre proteína, peso ou comportamento alimentar ficam para etapa posterior, após critérios nutricionais específicos.

Cada alerta deve mostrar motivo, período, dados de origem, data, severidade operacional, ação sugerida e possibilidade de resolver ou dispensar quando aplicável. Nenhum alerta representa diagnóstico.

## Comunicação profissional

O histórico persistido no sistema é a fonte principal da conversa. O WhatsApp funciona como canal de entrega e resposta.

Fluxo:

1. nutricionista escreve ou revisa a mensagem;
2. sistema registra conteúdo, paciente, autor e origem;
3. mensagem é enviada pelo canal aplicável;
4. status fica como pendente, enviado ou com falha;
5. resposta é associada ao acompanhamento quando houver contexto inequívoco;
6. histórico é exibido conforme visibilidade e consentimento.

Regras:

- mensagens da IA sempre começam como rascunho;
- IA não envia orientação automaticamente;
- origem da mensagem permanece identificada;
- mensagem enviada não é editada silenciosamente;
- falha não aparece como entrega concluída;
- retry é idempotente;
- orientação continua registrada mesmo se o WhatsApp falhar;
- respostas a solicitações usam contexto, callback, botão, código ou referência sempre que possível;
- transporte e formatação reutilizam a infraestrutura central da #779.

## Controles do nutricionista sobre a experiência do paciente

Na primeira versão, o nutricionista pode controlar:

- metas oficiais;
- orientações;
- pedidos de pesagem e registro;
- data da próxima revisão;
- lembretes do acompanhamento;
- frequência de resumos profissionais quando implementada;
- modelos de mensagem;
- critérios operacionais de alerta;
- informações profissionais apresentadas ao paciente.

O nutricionista não pode:

- apagar registros do paciente;
- ocultar histórico pessoal;
- impedir exportação, exclusão ou revogação conforme direitos do titular;
- modificar dados pessoais sem autorização;
- desativar funcionalidades básicas da Área do Paciente;
- acessar dados fora do escopo autorizado;
- alterar silenciosamente refeições confirmadas;
- transformar a conta do paciente em conta subordinada sem controle sobre os próprios dados.

## IA para o profissional

A IA pode:

- resumir períodos;
- comparar comportamentos;
- identificar fatores que contribuíram para desvios;
- localizar pacientes que precisam de atenção;
- preparar rascunhos de mensagens e orientações;
- responder perguntas com dados autorizados e contexto verificável.

A IA não pode:

- diagnosticar;
- prescrever de forma autônoma;
- alterar metas, refeições, comentários ou dados automaticamente;
- acessar paciente sem vínculo aprovado;
- ocultar a origem dos dados usados quando conferência for necessária.

## Separação de escopo das issues

### Fora da épica profissional

- correções de Hoje, Registros, Relatórios, Metas e alimentos do usuário individual;
- padronização geral do WhatsApp;
- timezone e datas do dono dos dados;
- autenticação, privacidade e IA compartilhadas;
- billing, checkout e elegibilidade comercial;
- onboarding geral iniciado pelo WhatsApp.

### Dentro da épica profissional

- persistência e migração do domínio profissional;
- navegação e layout próprios;
- dashboard e carteira;
- prontuário e avaliação inicial;
- ciclo do acompanhamento;
- metas oficiais e orientações;
- alertas e pendências;
- comunicação profissional;
- relatórios da carteira;
- configurações profissionais;
- apoio da IA no contexto do atendimento.

## Evolução incremental

1. Fundação persistente e migração.
2. Navegação e contexto profissional.
3. Carteira e painel inicial.
4. Prontuário e ciclo do acompanhamento.
5. Metas oficiais e orientações.
6. Alertas e comunicação profissional.
7. Relatórios da carteira e apoio da IA.
8. Integração com billing.
9. Desativação segura da experiência antiga.

Cada etapa deve manter a Área do Paciente funcional e proteger Hoje, Metas, Registros, Relatórios e WhatsApp contra regressões.

## Critérios de aceite da direção de produto

- Usuário comum mantém a experiência atual sem profissional.
- Usuário com perfil profissional acessa ambiente separado da experiência pessoal.
- A conta acumula os dois contextos sem duplicar identidade.
- Vínculos, autorizações e revogações permanecem protegidos e auditáveis.
- Autorização e situação do acompanhamento são estados distintos.
- O paciente selecionado fica claramente identificado em toda página profissional.
- A Área Profissional não depende de impersonação.
- Dados profissionais críticos sobrevivem a restart e múltiplas instâncias.
- Anotações privadas e orientações possuem visibilidade distinta.
- Avaliação inicial é versionada.
- Metas profissionais só são aplicadas com autoridade, vigência, histórico e notificação.
- Alertas iniciais são objetivos e explicáveis.
- Comunicação profissional possui histórico, origem e status de entrega.
- Transporte profissional reutiliza a infraestrutura central do WhatsApp.
- O paciente mantém seus dados e pode revogar o vínculo.
- Correções existentes não recebem funcionalidades profissionais fora do escopo original.

## Fora de escopo atual

- transformar profissional em tipo separado de conta;
- exigir profissional para usar o sistema;
- clínicas com múltiplos profissionais e permissões de equipe;
- prontuário médico completo, exames e diagnósticos nesta primeira versão;
- geração completa e automática de dieta;
- diagnóstico ou decisão clínica automatizada por IA;
- definir preços e limites nesta especificação;
- reescrever a Área do Paciente.

## Dependências

- `product-experience-model.md` para posicionamento e separação dos fluxos;
- especificações de metas, relatórios, WhatsApp, privacidade e integrações;
- #779 para contrato e transporte compartilhado do WhatsApp;
- #793 para timezone do dono dos dados;
- #145 para assinatura, limites e elegibilidade comercial.

## Decisões que permanecem abertas

Não bloqueiam as fases iniciais:

- limites, preços e definição comercial de paciente ativo;
- recursos comerciais incluídos para pacientes convidados;
- política de cobrança por WhatsApp e uso elevado de IA;
- campos clínicos ampliados para avaliações futuras;
- regras para assistentes, equipes e clínicas;
- critérios nutricionais avançados para alertas de proteína, peso e comportamento alimentar.
