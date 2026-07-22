# Decisões comerciais de billing

## Objetivo

Registrar, em um único documento versionado, as decisões comerciais que precisam ser aprovadas antes da integração de um provedor financeiro real, da publicação de preços ou da ativação de `BILLING_ACCESS_MODE=enforced`.

Este documento não autoriza cobrança por si só. Itens marcados como **Em aberto** não podem ser convertidos em hardcode, seed de produção, benefício, limite, downgrade, tolerância ou bloqueio definitivo.

## Contexto de produto já aprovado

- O principal cliente pagante será o profissional.
- O primeiro público profissional será o nutricionista com atendimento individual.
- O produto será oferecido pelo nutricionista aos pacientes.
- A pessoa poderá usar a Área do Paciente sem profissional.
- O profissional administrará metas, orientações e comunicação durante o acompanhamento.
- WhatsApp e web são canais complementares.
- Billing e Área Profissional permanecem programas separados.
- O perfil profissional continua sendo uma capacidade adicional da mesma conta.

## Registro das decisões bloqueantes

| ID | Decisão | Estado | Registro atual | Evidência necessária para aprovação |
|---|---|---|---|---|
| COM-01 | Provedor inicial de pagamento | **Em aberto** | Nenhum provider real foi escolhido. O código contém apenas o contrato `BillingProvider`. | Nome do provider, conta comercial, métodos aceitos, sandbox, produção, taxas, SLA e responsáveis. |
| COM-02 | Planos profissionais, preços, moeda e ciclos | **Em aberto** | O profissional é o pagador principal, mas catálogo, preços e ciclos não foram aprovados. | Tabela de planos com código estável, nome, preço em unidade inteira, moeda, ciclo e data de vigência. |
| COM-03 | Quantidade incluída e definição de paciente ativo | **Em aberto** | A capacidade técnica existe, mas não há conceito comercial definitivo de paciente ativo. | Regra observável para ocupar e liberar vaga, incluindo pausa, alta, vínculo e período de tolerância. |
| COM-04 | Entitlements do profissional e do paciente coberto | **Em aberto** | Existe catálogo técnico de recursos profissionais, sem matriz comercial aprovada por plano. | Matriz plano × recurso × perfil, incluindo web, WhatsApp, IA, relatórios e mensagens. |
| COM-05 | Existência, preço e recursos do plano individual | **Em aberto** | A pessoa pode usar a Área do Paciente sem profissional; não foi decidido se isso será gratuito ou pago. | Decisão explícita sobre existência, preço, ciclo, recursos e posicionamento do plano individual. |
| COM-06 | Usuário independente que inicia acompanhamento profissional | **Em aberto** | O domínio suporta assinatura própria e cobertura profissional simultâneas. | Regra de precedência comercial, comunicação e prevenção de cobrança duplicada. |
| COM-07 | Continuidade após perda da cobertura profissional | **Em aberto** | Dados são preservados e a elegibilidade é recalculada; a oferta posterior não foi definida. | Período de continuidade, recursos disponíveis, proposta de plano individual e comunicação. |
| COM-08 | Tratamento dos usuários atuais e transição | **Em aberto** | `open_access` permanece padrão. | Segmentos migrados, prazo, grandfathering, comunicação, suporte e rollback. |
| COM-09 | Trial, cupom, acesso gratuito e combinações | **Em aberto** | O domínio suporta trial, acesso gratuito e override, mas nenhuma política foi habilitada. | Elegibilidade, duração, repetição, combinação, expiração e necessidade de meio de pagamento. |
| COM-10 | Momento efetivo do cancelamento | **Em aberto** | O schema suporta `cancelAtPeriodEnd`, `canceledAt` e `endedAt`. | Cancelamento imediato ou no fim do período, reativação, reembolso e comunicação. |
| COM-11 | `past_due`, tolerância, recuperação e expiração | **Em aberto** | `past_due` não concede acesso por padrão na fundação. | Janela de tolerância, tentativas, notificações, suspensão, recuperação e expiração. |
| COM-12 | Cobrança variável por WhatsApp, IA ou consumo | **Em aberto** | Nenhum consumo variável é cobrado ou usado para elegibilidade. | Métrica faturável, franquia, preço, arredondamento, transparência, limite e contestação, ou decisão explícita de não cobrar. |

## Regras para registrar uma aprovação

Cada decisão aprovada deve incluir:

1. data de aprovação;
2. responsável pela decisão;
3. texto objetivo e testável;
4. data de vigência;
5. impacto sobre usuários atuais;
6. necessidade de comunicação;
7. consequência para backend, banco, frontend, WhatsApp e suporte;
8. plano de rollback quando houver bloqueio ou cobrança.

Não substituir **Em aberto** por expressões vagas como “conforme mercado”, “configurável” ou “decidir depois”. A configuração técnica só é válida depois que a regra de produto estiver definida.

## Catálogo técnico e fonte de verdade

Depois da aprovação:

- o catálogo deve ser persistido e servido pelo backend;
- valores monetários permanecem em unidade inteira da moeda;
- códigos de plano devem ser estáveis e independentes do provider;
- o frontend não pode possuir uma tabela comercial paralela;
- o adapter do provider mapeia produtos externos para códigos internos;
- ambientes de teste e produção usam identificadores externos distintos;
- mudanças de preço não reescrevem o histórico das assinaturas existentes.

## Gates antes de integrar o primeiro provider

- COM-01 a COM-04 aprovadas;
- COM-08, COM-10 e COM-11 aprovadas;
- política de privacidade e termos revisados para cobrança;
- responsável operacional e procedimento de suporte definidos;
- variáveis e segredos separados por ambiente;
- critérios de conciliação, webhook e recuperação documentados.

## Gates antes de ativar `enforced`

- todas as decisões aplicáveis aprovadas;
- matriz de entitlements versionada;
- usuários atuais classificados ou migrados;
- onboarding web e WhatsApp integrados à elegibilidade;
- rotas, procedures e comandos protegidos mapeados;
- checkout, webhook, sincronização e cancelamento validados em sandbox;
- observabilidade, fallback e rollback comprovados;
- comunicação e período de transição executados;
- aprovação explícita para alteração da variável de ambiente.

## Estado atual

A fundação provider-neutral, a consulta **Plano e acesso**, a administração de overrides e analytics, o gate de procedures protegidas e o bloqueio pré-pipeline do WhatsApp podem ser validados sem essas decisões.

Provider real, checkout, preço, cobrança, cancelamento comercial, inadimplência, trial e ativação de `enforced` permanecem bloqueados até a aprovação correspondente.
