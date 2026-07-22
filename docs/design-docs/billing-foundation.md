# Fundação provider-neutral de billing

## Objetivo e estado de rollout

Esta fundação implementa a primeira entrega técnica da épica #145. Ela persiste planos, assinaturas, eventos normalizados, entitlements, cobertura profissional, capacidade e exceções administrativas sem escolher um provedor financeiro real, sem cadastrar preço comercial definitivo e sem bloquear recursos existentes.

`BILLING_ACCESS_MODE=open_access` é o padrão. Nesse modo, ausência ou falha da persistência comercial mantém o acesso atual e registra apenas diagnóstico sanitizado. `BILLING_ACCESS_MODE=enforced` deve ser ativado somente depois de aprovadas a matriz de recursos pagos, a migração dos usuários atuais e as políticas comerciais bloqueantes da épica.

## Fronteiras do domínio

O modelo diferencia explicitamente:

- **titular/pagador**: `billingSubscriptions.payerUserId`;
- **beneficiário**: `billingEntitlements.beneficiaryUserId`;
- **patrocinador**: `billingEntitlements.sponsorUserId`;
- **vínculo clínico**: `professionalPatientAuthorizations`, que continua sendo a autorização de acesso aos dados;
- **origem comercial**: `sourceType` e `sourceId` do entitlement.

Cobertura profissional não cria assinatura em nome do paciente. Exceção administrativa também não cria assinatura, checkout ou registro falso no provedor. Encerrar cobertura libera a vaga e termina o entitlement, mas não apaga usuário, vínculo, prontuário ou histórico.

## Persistência

- `billingPlans`: catálogo provider-neutral; valores monetários em unidade inteira da moeda; plano inativo deixa de aceitar novas vendas, sem invalidar automaticamente assinaturas vigentes.
- `billingSubscriptions`: titular, plano, provider, identificadores externos, período e estado normalizado (`pending`, `active`, `past_due`, `canceled`, `expired`).
- `billingProviderEvents`: envelope normalizado e idempotente por `(provider, providerEventId)`.
- `billingEntitlements`: concessões próprias, patrocinadas, trial, acesso gratuito configurado ou override administrativo.
- `billingCapacityAllocations`: ocupação e liberação auditável de vagas profissionais por `coverageKey`.
- `billingAdminOverrides`: concessões manuais com motivo, vigência, autoria, revogação e histórico preservado.
- `billingAccessAuditEvents`: trilha append-only das mudanças de acesso e capacidade.

A migration canônica é `drizzle/0035_billing_foundation.sql`. O workflow `Billing persistence TiDB gate` aplica o schema em TiDB, verifica drift do metadata Drizzle, executa concorrência/idempotência e roda integridade referencial.

## Eventos do provider e minimização

O domínio não persiste payload bruto de webhook. Um provider futuro deve autenticar o corpo original, normalizar o evento e entregar ao repositório somente metadata permitida por `sanitizeBillingProviderEventMetadata`.

A lista permitida contém apenas identificadores operacionais, estado, motivo sanitizado, moeda, valor em unidade inteira, referências comerciais e instante do provider. Chaves de cartão, CVV, token, segredo, endereço, e-mail, telefone e objetos aninhados são descartados. A repetição do mesmo `providerEventId` retorna o evento já registrado, sem duplicar processamento.

## Elegibilidade e precedência

`getUserEntitlements(userId)` é o contrato central para web, tRPC e integrações. A precedência determinística é:

1. assinatura própria ativa;
2. cobertura válida por profissional;
3. trial ativo;
4. exceção administrativa ativa;
5. acesso gratuito configurado;
6. ausência de acesso.

Dentro da mesma origem, vence a concessão com maior validade; empate é resolvido pelo identificador da fonte. Registros futuros ou expirados são descartados defensivamente. Apenas assinatura `active` dentro do período concede acesso; `pending`, `past_due`, `canceled` e `expired` não concedem.

Cobertura profissional exige simultaneamente assinatura ativa do patrocinador, vaga ativa, entitlement ativo e autorização profissional-paciente aprovada. Assinatura não substitui consentimento clínico.

## Capacidade profissional

`configureBillingProfessionalEntitlementProvider` registra o provider canônico no contrato da Área Profissional. O módulo profissional consome recursos e capacidade, mas não consulta tabelas financeiras nem calcula limite.

Para planos com capacidade finita:

- a assinatura ativa é bloqueada na transação antes da contagem;
- a última vaga só pode ser ocupada por uma solicitação concorrente;
- `coverageKey` torna a reserva idempotente;
- ultrapassar o limite retorna `capacity_exceeded` e não cria cobertura parcial;
- falha da transição clínica dispara compensação pelo contrato profissional existente;
- liberação repetida é idempotente;
- revogação do vínculo pelo paciente nunca depende do sucesso da integração comercial para concluir a decisão clínica.

A definição comercial futura de “paciente ativo”, downgrade, tolerância e inadimplência ainda pertence à épica #145. Esta fundação não codifica essas decisões como regra definitiva.

## Administração

As procedures `billing.adminSearchUsers`, `billing.adminListOverrides`, `billing.adminGrantOverride`, `billing.adminRevokeOverride` e `billing.adminAnalytics` usam `adminProcedure`. A autoria é sempre obtida de `ctx.user.id`; o cliente não informa quem concedeu ou revogou.

A busca suporta nome, e-mail e telefone. Quando há filtro por motivo efetivo de acesso, o serviço percorre páginas estáveis de usuários até preencher o limite solicitado ou esgotar os resultados; o filtro nunca é aplicado somente depois do primeiro `LIMIT`. Cada resultado inclui o override ativo efetivo, quando existir, com o identificador necessário para uma revogação posterior.

`adminListOverrides` recupera o histórico recente por usuário, incluindo identificador, motivo, vigência, autoria, revogação e estado efetivo. Assim, grant e revoke formam um fluxo durável mesmo após recarregar a aplicação ou transferir o atendimento para outro administrador.

A análise separa status de assinatura, overrides ativos, beneficiários cobertos, ocupação e receita recorrente estimada por moeda. `usersWithoutCommercialAccess` usa as mesmas condições canônicas de assinatura própria, cobertura profissional, trial, acesso gratuito e override aplicadas na elegibilidade. Assinaturas futuras e coberturas sem assinatura, vaga ou autorização válidas não são contabilizadas como acesso. Valores de moedas diferentes nunca são somados. Ciclo anual é dividido por 12 apenas para estimativa e permanece identificado como estimativa.

A interface administrativa completa será uma entrega posterior da épica. A proteção e a completude do fluxo de backend já são obrigatórias e não podem ser substituídas por ocultação de menu ou pela retenção temporária de IDs no cliente.

## Contrato para provider financeiro futuro

`BillingProvider` define checkout hospedado, sincronização, cancelamento e autenticação/normalização de webhook. Nenhuma implementação real é registrada nesta entrega. O retorno do navegador não fará parte da confirmação de acesso; ativação futura dependerá de estado confirmado pelo backend.

Ao integrar o primeiro provider real:

1. registrar decisões comerciais na épica #145;
2. mapear estados externos para os cinco estados internos;
3. autenticar webhook sobre o corpo bruto sem persisti-lo;
4. gravar o evento normalizado antes do processamento;
5. aplicar transação idempotente e impedir regressão por evento fora de ordem;
6. manter `open_access` até o rollout ser aprovado.

## Validação

- testes unitários: precedência, validade, estados, fallback, sanitização, provider profissional e autorização administrativa;
- teste TiDB: última vaga concorrente, retry de reserva, liberação repetida, cobertura derivada, histórico e recuperação durável de override, consistência entre analytics e elegibilidade, evento duplicado e payload sanitizado;
- `pnpm agent:check`;
- `pnpm build`;
- `pnpm db:test:billing` e `pnpm db:check-integrity` quando houver banco.
