# Modelo de produto e áreas de experiência

## Decisão de produto

O Controle de Calorias é uma plataforma de acompanhamento nutricional contínuo com duas experiências de primeira classe:

- **Área do Paciente**, usada para registrar alimentação, acompanhar metas, evolução, exercícios, peso e orientações;
- **Área Profissional**, usada pelo nutricionista para administrar a carteira, definir condutas de acompanhamento, monitorar evolução e se comunicar com pacientes.

O principal cliente pagante e foco comercial inicial é o **nutricionista com atendimento individual**. O produto é oferecido pelo nutricionista aos seus pacientes, mas a pessoa também pode criar uma conta e utilizar a Área do Paciente sem vínculo profissional.

A estratégia comercial não transforma a experiência do paciente em um recurso secundário. A qualidade e a frequência dos registros do paciente são parte central do valor entregue ao profissional.

## Perfis e identidade

- Uma conta pode possuir somente experiência pessoal ou acumular perfil pessoal e perfil profissional.
- O perfil profissional continua sendo uma capacidade adicional da mesma conta, não um tipo separado de usuário.
- O nutricionista pode usar a própria Área do Paciente e alternar explicitamente para a Área Profissional.
- Um paciente sem perfil profissional não deve visualizar navegação profissional.
- A Área Profissional nunca deve funcionar por impersonação ou login na conta do paciente.
- Toda operação profissional deve identificar separadamente o ator profissional e o paciente afetado.

## Área do Paciente

A Área do Paciente corresponde à experiência já desenvolvida e deve continuar funcionando com ou sem vínculo profissional.

Responsabilidades principais:

- registro de refeições por texto, imagem, áudio ou preenchimento manual;
- revisão e correção antes da persistência;
- acompanhamento diário, semanal e histórico;
- metas nutricionais, exceções e configuração de exercícios;
- peso, hidratação, exercícios e integrações de saúde;
- relatórios e evolução;
- alimentos habituais, favoritos e configurações pessoais;
- comunicação e registros pelo WhatsApp;
- recebimento de metas, orientações, solicitações e mensagens do profissional quando houver vínculo.

Uma conta independente deve poder iniciar acompanhamento profissional sem migração e sem perda de histórico. O encerramento do vínculo não deve apagar o histórico pessoal do paciente.

## Área Profissional

A Área Profissional deve evoluir como um ambiente próprio de trabalho, com navegação, páginas, permissões e fluxos dedicados. A tela única com abas existente é a linha de base funcional atual, não o desenho final do módulo.

Responsabilidades alvo:

- painel inicial com prioridades, alertas e pendências;
- gestão da carteira de pacientes;
- convite, vínculo, consentimento, pausa e encerramento do acompanhamento;
- prontuário operacional individual por paciente;
- avaliação inicial e histórico de acompanhamento;
- definição e revisão de metas oficiais;
- registro de orientações profissionais;
- acompanhamento de alimentação, peso, exercícios, adesão e evolução;
- comunicação individual por web e WhatsApp;
- solicitações de registro, pesagem e revisão;
- relatórios individuais e da carteira;
- apoio da IA para resumir dados e priorizar atenção, sem decisão clínica automatizada;
- configurações profissionais, identidade, plano e cobrança.

## Autoridade, consentimento e histórico

- O acesso profissional depende de vínculo autorizado pelo paciente.
- O paciente mantém acesso ao próprio histórico durante e depois do acompanhamento.
- No modelo alvo, o nutricionista pode definir metas oficiais e orientações para o paciente acompanhado.
- O comportamento atual baseado em sugestões deve ser preservado até existir fluxo versionado, auditável e explicitamente implementado para aplicação de metas profissionais.
- Alterações profissionais relevantes devem registrar ator, paciente, data, valor anterior, novo valor e justificativa quando aplicável.
- Revogação ou encerramento do vínculo deve bloquear novos acessos profissionais sem apagar o histórico auditável.
- A IA pode resumir, comparar, explicar e sugerir comunicação, mas não deve diagnosticar, prescrever ou alterar dados automaticamente.

## WhatsApp

O WhatsApp possui dois papéis complementares:

1. **canal do paciente**, para registros, consultas, correções, peso, exercícios e respostas a solicitações;
2. **canal de comunicação profissional**, para orientações, lembretes, pedidos de pesagem, revisões e mensagens de acompanhamento.

A interface e as mensagens devem distinguir claramente conteúdo automático, conteúdo sugerido pela IA e mensagem enviada pelo nutricionista.

## Separação dos fluxos de trabalho

As issues devem ser classificadas por objetivo para impedir que a nova estratégia profissional amplie correções já em andamento.

### 1. Experiência atual do paciente

Inclui correções e melhorias no uso individual: Hoje, Registrar, Registros, Relatórios, Metas, alimentos, peso, exercícios, integrações e experiência pessoal no WhatsApp.

Essas issues devem manter seu escopo original e não receber dashboard de carteira, prontuário ou gestão profissional apenas porque o dado também será consumido futuramente pela Área Profissional.

### 2. Plataforma compartilhada

Inclui contratos e infraestrutura utilizados pelas duas áreas: autenticação, timezone, persistência, privacidade, autorização, transporte do WhatsApp, IA, relatórios canônicos e serviços de domínio.

Uma issue só deve ser classificada como compartilhada quando o mesmo contrato ou regra realmente precisar atender paciente e profissional. A interface profissional não deve ser adicionada automaticamente a uma correção compartilhada.

### 3. Programa da Área Profissional

Inclui exclusivamente a evolução do ambiente do nutricionista: navegação própria, dashboard profissional, carteira, prontuário, acompanhamento, metas oficiais, orientações, mensagens, alertas, relatórios da carteira e configurações profissionais.

Esse programa deve possuir uma épica própria e subissues incrementais. Issues preexistentes não passam a fazer parte dessa épica apenas por mencionarem profissional ou paciente.

### 4. Comercial e billing

Inclui planos, checkout, assinatura, elegibilidade, limites, cobrança e administração comercial. A épica de billing permanece separada da construção da experiência profissional.

A decisão comercial aprovada é:

- principal pagante: profissional;
- público inicial: nutricionista com atendimento individual;
- proposta: ferramenta que o nutricionista oferece aos pacientes;
- paciente independente: permitido;
- definição de metas e orientações: responsabilidade do profissional durante o acompanhamento;
- comunicação: web e WhatsApp.

Preços, limites de pacientes, definição de paciente ativo, trial, tolerância e matriz de entitlements continuam como decisões específicas de billing.

## Regras para issues existentes

- Não ampliar uma issue corretiva para implementar funcionalidades da nova Área Profissional.
- Não alterar critérios de aceite existentes apenas para refletir a visão futura, salvo quando houver conflito real com uma decisão de produto aprovada.
- Quando uma correção precisar proteger a futura Área Profissional, limitar a entrega a contratos estáveis e prevenção de regressão.
- Criar nova subissue profissional para interface, fluxo ou regra exclusiva do nutricionista.
- Manter billing, onboarding comercial e experiência profissional em épicas separadas, ligadas apenas por dependências explícitas.
- Mudanças transversais devem declarar qual área é dona do dado e qual área apenas o consome.

Exemplos do backlog aberto no momento desta decisão:

- #779 e subissues: padronização compartilhada do WhatsApp;
- #793 e subissues: fundação compartilhada de timezone;
- #801: melhoria do catálogo/experiência atual de alimentos;
- #145: fundação comercial e billing;
- #209, #215 e #217: onboarding e ativação comercial;
- nova evolução de dashboard, carteira e prontuário: programa exclusivo da Área Profissional.

## Evolução incremental

A evolução profissional deve acontecer sem reescrever a Área do Paciente:

1. estrutura e navegação próprias, dashboard básico, carteira e perfil resumido;
2. prontuário, metas oficiais, orientações, histórico e alertas;
3. comunicação profissional por web e WhatsApp;
4. resumos, priorização e apoio da IA;
5. billing profissional, limites e operação comercial, coordenados pela épica de billing.

Cada etapa deve preservar o uso independente do paciente e os contratos compartilhados existentes.

## Fora de escopo desta decisão

- transformar profissional em tipo separado de conta;
- substituir ou remover a Área do Paciente;
- exigir vínculo profissional para usar o sistema;
- permitir decisão clínica automatizada por IA;
- definir agora preços, quantidade de pacientes ou regras de clínica com múltiplos profissionais;
- misturar a reconstrução da Área Profissional com correções já abertas do produto atual.

## Decisões ainda abertas

- limites e preços dos planos profissionais;
- definição comercial de paciente ativo;
- recursos incluídos para o paciente convidado;
- política para plano individual e eventual conversão para acompanhamento profissional;
- nível de configuração da experiência do paciente pelo nutricionista;
- permissões futuras para assistentes, equipes e clínicas;
- política de cobrança por mensagens de WhatsApp e uso intensivo de IA.