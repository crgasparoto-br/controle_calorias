# Configurações profissionais e entitlements

## Objetivo

A Área Profissional possui uma tela própria para identificação pública, preferências operacionais, modelos de mensagem, critérios suportados pela central de alertas e leitura do acesso comercial. A identidade de login continua única e as configurações pessoais permanecem fora deste contexto.

## Separação de responsabilidades

- `professionalProfiles` continua sendo a fonte canônica para nome profissional, registro e estado ativo/inativo.
- Preferências não clínicas são armazenadas em `userPreferences` sob a chave versionada `professional_settings_v1` e validadas por Zod antes de leitura e gravação.
- Prontuários, avaliações, orientações, mensagens e histórico não podem ser apagados ou ocultados por esta tela.
- A visão disponibilizada ao paciente contém somente nome, registro, contato profissional opcional e apresentação pública. Modelos e preferências internas nunca são retornados ao paciente.

## Operações

A API `professionalRecord.settings` oferece operações independentes para reduzir risco de estado parcial:

- `get`: perfil, identificação pública, preferências, critérios suportados e entitlements;
- `updateIdentity`: identificação profissional e dados públicos opcionais;
- `updatePreferences`: revisão padrão, lembretes, frequência de resumo e modelos;
- `setActive`: ativa ou desativa a Área Profissional sem remover histórico;
- `entitlements`: reavalia o snapshot comercial sem cache indefinido;
- `patientVisible`: retorna somente dados públicos de profissionais ativos com autorização aprovada.

Alterações geram eventos auditáveis em `professionalHistoryEvents`. Modelos apenas preenchem rascunhos e não acionam envio automático.

## Estado ativo

A desativação mantém todos os dados persistidos, remove a disponibilidade da navegação profissional pelo gate já existente e bloqueia operações profissionais que exigem perfil ativo. A reativação continua disponível no fluxo de perfil pessoal existente.

## Critérios operacionais

A tela consome `PROFESSIONAL_OPERATIONAL_ALERT_CRITERIA`, exportado pelo mesmo módulo de regras usado pela central de alertas. Somente critérios realmente suportados são apresentados. O critério atual de ausência de registros alimentares permanece fixo em três dias civis no timezone do paciente e, por isso, é exibido como não configurável em vez de criar uma configuração sem efeito.

## Contrato de entitlements

`entitlementService.ts` é o ponto único de integração com o futuro billing da issue #145. O snapshot normaliza:

- acesso permitido ou negado;
- razão da elegibilidade;
- estado comercial e plano;
- validade;
- recursos habilitados;
- capacidade, uso e disponibilidade;
- disponibilidade do provider e uso de fallback.

Enquanto o provider comercial não está implementado, `BILLING_ACCESS_MODE` usa `open_access` por padrão e preserva todos os recursos atuais. Falha do provider não bloqueia o profissional nesse modo. Em `enforced`, ausência ou falha do provider resulta em negação segura. O serviço não mantém cache de autorização e oferece gates para recurso e capacidade, garantindo que uma operação possa validar o limite antes de iniciar qualquer gravação.

## Segurança e privacidade

- Nenhum preço, token, segredo de integração, dado de cobrança ou método de pagamento é persistido nesta configuração.
- O frontend não calcula elegibilidade, plano ou capacidade.
- Recursos desconhecidos retornados por um provider são descartados.
- Configuração inválida não é aplicada silenciosamente.
- Falha de leitura em produção não substitui preferências por uma gravação automática de defaults.

## Evolução com a issue #145

A implementação comercial deve registrar um provider no contrato central e manter a mesma forma normalizada. Checkout, cobrança, webhooks, preços, limites concretos e definição comercial de paciente ativo permanecem fora da issue #814.
