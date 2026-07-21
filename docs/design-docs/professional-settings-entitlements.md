# Configurações profissionais e entitlements

## Objetivo

A Área Profissional possui uma tela própria para identificação pública, preferências operacionais, modelos de mensagem, critérios suportados pela central de alertas e leitura do acesso comercial. A identidade de login continua única e as configurações pessoais permanecem fora deste contexto.

## Separação de responsabilidades

- `professionalProfiles` continua sendo a fonte canônica para nome profissional, registro e estado ativo/inativo.
- Preferências não clínicas são armazenadas em `userPreferences` sob a chave versionada `professional_settings_v1` e validadas por Zod antes de leitura e gravação.
- Prontuários, avaliações, orientações, mensagens e histórico não podem ser apagados ou ocultados por esta tela.
- A visão disponibilizada ao paciente contém somente nome, registro, contato profissional opcional e apresentação pública. Modelos e preferências internas nunca são retornados ao paciente.
- Limite, consumo e definição comercial de paciente ativo pertencem exclusivamente ao provider central da issue #145; o módulo profissional não infere uso por consultas locais.

## Operações

A API `professionalRecord.settings` oferece operações independentes para reduzir risco de estado parcial:

- `get`: perfil, identificação pública, preferências suportadas, critérios centrais e entitlements;
- `updateIdentity`: identificação profissional e dados públicos opcionais;
- `updatePreferences`: intervalo padrão de revisão e modelos de mensagem;
- `setActive`: ativa ou desativa a Área Profissional sem remover histórico;
- `entitlements`: reavalia o snapshot comercial sem cache indefinido;
- `patientVisible`: retorna somente dados públicos de profissionais ativos com autorização aprovada.

Alterações são serializadas por profissional. Se a gravação do evento de auditoria falhar, a alteração afetada é compensada antes de o erro retornar. Falha da própria compensação é registrada e retorna um erro explícito de consistência; ela não é ignorada. Eventos de configuração usam identificador próprio e não registram conteúdo de modelos ou outros dados sensíveis.

O intervalo padrão de revisão é aplicado quando uma nova avaliação não informa explicitamente a próxima revisão. Modelos podem preencher o tipo e o conteúdo do rascunho na tela de mensagens, mas salvar ou enviar continua dependendo de ação explícita do profissional.

Lembretes continuam sendo criados no contexto de cada paciente pela central de acompanhamento. Frequência de resumo automático não é exposta enquanto não existir um consumidor operacional. O contrato de entrada é estrito e contém somente controles efetivamente suportados. Dados antigos com chaves de automação obsoletas continuam legíveis e convergem para o contrato atual na próxima gravação, sem migration destrutiva.

## Estado ativo e proteção por recurso

A desativação mantém todos os dados persistidos, remove a disponibilidade da navegação profissional pelo gate existente e bloqueia operações profissionais que exigem perfil ativo. A reativação continua disponível no fluxo de perfil pessoal existente.

As APIs de prontuário, metas oficiais, alertas, mensagens e assistência por IA usam procedures especializadas. As APIs legadas em `nutrition.professionals` passam por uma política central registrada no middleware de procedures protegidas. Essa política distingue operações do profissional de decisões executadas pelo paciente e exige o recurso específico, como carteira, relatório, prontuário, metas ou IA.

No frontend, cada rota profissional declara seu próprio recurso. Um snapshot com `allowed: true` não libera uma rota quando o recurso correspondente não está presente em `enabledResources`.

## Critérios operacionais

A tela consome `PROFESSIONAL_OPERATIONAL_ALERT_CRITERIA`, exportado pelo mesmo módulo de regras usado pela central de alertas. Somente critérios realmente suportados são apresentados. O critério atual de ausência de registros alimentares permanece fixo em três dias civis no timezone do paciente e, por isso, é exibido como não configurável em vez de criar uma configuração sem efeito.

## Contrato de entitlements

`entitlementService.ts` é o ponto único de integração com o futuro billing da issue #145. O snapshot normaliza:

- acesso permitido ou negado;
- razão da elegibilidade;
- estado comercial e plano;
- validade;
- recursos habilitados;
- capacidade, uso e disponibilidade fornecidos pelo provider;
- disponibilidade do provider e uso de fallback.

O billing registra sua implementação por `configureProfessionalEntitlementProvider`. Recursos desconhecidos são descartados, validade expirada revoga o acesso em modo obrigatório e nenhuma decisão comercial é calculada no frontend.

`BILLING_ACCESS_MODE=open_access` é uma política de rollout, não apenas um fallback de indisponibilidade. Enquanto estiver ativo, todos os recursos profissionais permanecem liberados mesmo que o provider esteja disponível e responda que não há assinatura. Dados comerciais retornados ainda podem ser exibidos, mas não bloqueiam operações nem capacidade. Em `enforced`, ausência, falha, expiração ou negação do provider resultam em bloqueio seguro. O serviço não mantém cache de autorização.

Quando o provider retorna capacidade finita em modo obrigatório, a aprovação exige `reserveCapacity` e `releaseCapacity`. A reserva deve ser atômica, e a liberação deve ser idempotente pela mesma `coverageKey`, ambas no domínio central. Um contrato que permita reservar sem liberar é rejeitado antes da transição clínica. Se o limite tiver sido atingido, somente uma aprovação concorrente pode ocupar a última vaga. Se a transição clínica falhar depois da reserva, `releaseCapacity` é chamado para compensação.

Depois de uma aprovação concluída, a revogação do vínculo solicita ao provider a liberação pela mesma `coverageKey`. Indisponibilidade comercial não impede o paciente de revogar; a falha é registrada para recuperação segura pelo provider.

Redução de plano abaixo da carteira atual não remove pacientes nem histórico; apenas novas aprovações ficam sujeitas ao resultado central de capacidade quando o modo obrigatório estiver ativo.

## Segurança e privacidade

- Nenhum preço, token, segredo de integração, dado de cobrança ou método de pagamento é persistido nesta configuração.
- O frontend não calcula elegibilidade, plano ou capacidade.
- Recursos desconhecidos retornados por um provider são descartados.
- Configuração inválida não é aplicada silenciosamente.
- Falha de leitura em produção não substitui preferências por uma gravação automática de defaults.
- Alterações comerciais não apagam pacientes, prontuários, mensagens ou histórico.
- Procedures do paciente para aprovar, recusar ou revogar vínculo permanecem independentes da elegibilidade comercial do profissional.

## Evolução com a issue #145

A implementação comercial deve registrar um provider no contrato central e manter a mesma forma normalizada. O provider será responsável pela persistência auditável da capacidade, definição comercial de paciente ativo, idempotência da reserva, correlação pela `coverageKey`, retry e liberação de vagas. Checkout, cobrança, webhooks, preços e limites concretos permanecem fora da issue #814.
