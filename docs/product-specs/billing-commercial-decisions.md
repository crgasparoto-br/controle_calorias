# Decisões comerciais de billing

## Objetivo

Registrar, em um único documento versionado, as decisões vinculantes consolidadas pela épica #145 e separar essas decisões da implementação incremental das subissues.

Este documento não autoriza cobrança real, publicação de preços ou ativação de `BILLING_ACCESS_MODE=enforced`. A implementação continua condicionada aos gates e às issues indicadas abaixo.

## Contexto de produto aprovado

- O principal cliente pagante será o profissional.
- O primeiro público profissional será o nutricionista com atendimento individual.
- O produto será oferecido pelo nutricionista aos pacientes.
- A pessoa poderá usar a Área do Paciente sem profissional.
- O profissional administrará metas, orientações e comunicação durante o acompanhamento.
- WhatsApp e web são canais complementares.
- Billing e Área Profissional permanecem programas separados.
- O perfil profissional continua sendo uma capacidade adicional da mesma conta.

## Registro das decisões vinculantes

| ID | Decisão | Estado | Regra vinculante | Implementação |
|---|---|---|---|---|
| COM-01 | Provedor inicial de pagamento | **Definida para implementação posterior** | A fundação permanece provider-neutral. A integração inicial será feita por adapter, sem espalhar contratos externos pelo domínio. Nenhum provider real pertence à #869. | #892 |
| COM-02 | Planos profissionais, preços, moeda e ciclos | **Definida** | Catálogo versionado e servido pelo backend; valores monetários em unidade inteira; códigos estáveis e independentes do provider; histórico não é reescrito por mudança de preço. | #891 |
| COM-03 | Quantidade incluída e definição de paciente ativo | **Definida** | Capacidade é associada à assinatura profissional e consumida por cobertura de paciente ativa, com reserva/liberação transacional e idempotente por `coverageKey`. O uso pessoal do pagador profissional não consome vaga. | #891 e #894 |
| COM-04 | Entitlements do profissional e do paciente coberto | **Definida** | Profissional e Profissional Plus possuem a mesma matriz de recursos e diferem inicialmente pela capacidade. O pagador profissional recebe, na mesma assinatura, a matriz pessoal do Individual e a matriz profissional. O paciente coberto recebe a matriz pessoal definida pela épica. | #891 e #894 |
| COM-05 | Existência, preço e recursos do plano individual | **Definida** | Existe modalidade Individual para uso pessoal sem profissional. Catálogo, preço, ciclo e matriz são versionados no backend, sem tabela comercial paralela no frontend. | #891 |
| COM-06 | Usuário independente que inicia acompanhamento profissional | **Definida** | Origens válidas coexistem sem serem apagadas. A origem efetiva segue a precedência vinculante e não cria assinatura duplicada. | #893 e #894 |
| COM-07 | Continuidade após perda da cobertura profissional | **Definida** | Dados não são apagados. A elegibilidade é recalculada e pode resultar em transição e, depois, acesso somente para leitura, cada qual como origem explícita e expirável conforme catálogo/política. | #893 e #898 |
| COM-08 | Tratamento dos usuários atuais e transição | **Definida** | `open_access` permanece padrão até rollout explícito. Usuários atuais devem ser classificados antes de `enforced`, com transição, comunicação, observabilidade e rollback. | #898 |
| COM-09 | Trial, cupom, acesso gratuito e combinações | **Definida** | Trial é origem de acesso; cupom não é origem. Isenção administrativa é expirável e revogável e tem precedência máxima. Combinações preservam origens secundárias válidas. | #891, #893 e #896 |
| COM-10 | Momento efetivo do cancelamento | **Definida** | O domínio suporta cancelamento no fim do período por `cancelAtPeriodEnd`; encerramento efetivo e reativação são processados pelo ciclo comercial, preservando histórico. | #893 |
| COM-11 | `past_due`, tolerância, recuperação e expiração | **Definida** | `past_due` não concede acesso pago por si só na fundação. Tolerância, recuperação, expiração e comunicação são estados explícitos do ciclo comercial e nunca são inferidos apenas pelo frontend. | #893 e #898 |
| COM-12 | Cobrança variável por WhatsApp, IA ou consumo | **Definida** | Não há cobrança variável por WhatsApp, IA ou consumo no escopo aprovado inicial. Medição pode existir para observabilidade e evolução, sem alterar elegibilidade ou fatura sem nova decisão versionada. | #897 |

## Precedência vinculante de acesso

Quando houver múltiplas origens válidas, o backend aplica, nesta ordem:

1. isenção administrativa;
2. cobertura profissional;
3. assinatura própria paga;
4. trial;
5. período de transição;
6. acesso somente para leitura.

A precedência define origem efetiva, atribuição de consumo e comunicação. Origens secundárias ainda válidas permanecem registradas. Cupom não é origem de acesso.

## Matriz profissional vinculante

- Profissional e Profissional Plus concedem ao próprio pagador a matriz pessoal do Individual junto com a matriz profissional.
- Não existe assinatura individual adicional, cobertura sobre o próprio profissional ou cobrança duplicada.
- O uso pessoal do pagador profissional não reserva nem consome vaga de paciente.
- Profissional e Plus diferem inicialmente somente pela capacidade.
- Pacientes cobertos recebem a matriz pessoal congelada na versão profissional contratada; ela é persistida separadamente da matriz combinada do pagador para impedir alteração retroativa de benefícios.

## Catálogo técnico e fonte de verdade

- o catálogo é persistido e servido pelo backend;
- valores monetários permanecem em unidade inteira da moeda;
- códigos de plano são estáveis e independentes do provider;
- o frontend não mantém tabela comercial paralela;
- adapters mapeiam produtos externos para códigos internos;
- ambientes de teste e produção usam identificadores externos distintos;
- mudanças de preço não reescrevem o histórico de assinaturas existentes.

## Gates antes de integrar o primeiro provider

- catálogo, matriz e capacidades versionados;
- política de privacidade e termos revisados para cobrança;
- responsável operacional e procedimento de suporte definidos;
- variáveis e segredos separados por ambiente;
- critérios de conciliação, webhook e recuperação documentados;
- sandbox validado sem ativar cobrança em produção.

## Gates antes de ativar `enforced`

- usuários atuais classificados ou migrados;
- onboarding web e WhatsApp integrados à elegibilidade;
- rotas, procedures e comandos protegidos mapeados;
- checkout, webhook, sincronização e cancelamento validados em sandbox;
- observabilidade, fallback e rollback comprovados;
- comunicação e período de transição executados;
- aprovação explícita para alteração da variável de ambiente.

## Estado atual

A #869 entrega somente a fundação provider-neutral: persistência, elegibilidade central, capacidade profissional, overrides administrativos, onboarding recuperável e superfícies de consulta/administração.

Provider real, checkout, catálogo final, preços, cobrança, ciclo comercial, interfaces finais, medição e rollout permanecem nas subissues da épica. `BILLING_ACCESS_MODE=open_access` continua sendo o padrão obrigatório até a aprovação do rollout.

## Implementação do catálogo versionado — #891

A #891 materializa COM-02, COM-03, COM-04, COM-05 e o contrato de cupons de COM-09 sem ativar provider financeiro nem `enforced`:

- três produtos estáveis (`individual`, `professional`, `professional-plus`) e seis versões comerciais iniciais mensal/anual;
- preços em centavos de BRL: 3.990/35.900, 8.990/89.900 e 13.990/139.900;
- capacidade profissional de 30 e 100 pacientes; uso pessoal do pagador não consome vaga;
- matriz profissional composta pela matriz pessoal mais recursos profissionais;
- política comercial `credit_card` + `pix_automatic`, separada das capacidades efetivas do provider;
- versões antigas preservadas para assinaturas existentes e novas contratações limitadas à versão ativa/vigente;
- cupons revisionados, não cumulativos, com limite de 30%, até três cobranças mensais, primeira cobrança anual e rejeição de 100%;
- criação/publicação/desativação exclusivamente administrativa, com motivo, autoria e auditoria; alertas de capacidade nunca criam ou publicam plano automaticamente.

O seed é idempotente e deve falhar diante de drift das definições canônicas em vez de reescrever silenciosamente uma versão já existente. A validação de migration, concorrência de cupom e integridade permanece no gate TiDB de billing.
