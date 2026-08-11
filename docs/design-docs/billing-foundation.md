# Fundação provider-neutral de billing

## Objetivo e estado de rollout

Esta fundação implementa as entregas técnicas provider-neutral da épica #145. Ela persiste planos, assinaturas, eventos normalizados, entitlements, cobertura profissional, capacidade e exceções administrativas sem escolher um provedor financeiro real nem cadastrar preço comercial definitivo.

`BILLING_ACCESS_MODE=open_access` é o padrão. Nesse modo, ausência ou falha da persistência comercial mantém o acesso atual e registra apenas diagnóstico sanitizado. `BILLING_ACCESS_MODE=enforced` deve ser ativado somente depois de concluídos catálogo, migração dos usuários atuais, comunicação e rollback.

As interfaces implementadas nesta etapa são consultivas e operacionais sobre o contrato provider-neutral. Elas não oferecem checkout, alteração de plano ou cancelamento.

## Fronteiras do domínio

O modelo diferencia explicitamente:

- **titular/pagador**: `billingSubscriptions.payerUserId`;
- **beneficiário**: `billingEntitlements.beneficiaryUserId`;
- **patrocinador**: `billingEntitlements.sponsorUserId`;
- **vínculo clínico**: `professionalPatientAuthorizations`, que continua sendo a autorização de acesso aos dados;
- **origem comercial**: `sourceType` e `sourceId` do entitlement.

Cobertura profissional não cria assinatura em nome do paciente. Exceção administrativa também não cria assinatura, checkout ou registro falso no provider. Encerrar cobertura libera a vaga e termina o entitlement, mas não apaga usuário, vínculo, prontuário ou histórico.

## Persistência

- `billingProducts`: identidade estável da família comercial, independente de provider, preço, ciclo e revisão.
- `billingPlans`: versões comerciais imutáveis vinculadas ao produto; preservam ciclo, preço em unidade inteira, capacidade, matriz do pagador, matriz do paciente coberto quando aplicável, meios autorizados, vigência, estado e ordem. Assinaturas continuam referenciando a versão contratada por `planId`.
- `billingSubscriptions`: titular, plano, provider, identificadores externos, período e estado de compatibilidade (`pending`, `active`, `past_due`, `canceled`, `expired`). A semântica canônica de ciclo de vida da #893 fica em `billingSubscriptionLifecycle`; nesse campo de compatibilidade, `suspended` continua representado como `past_due` enquanto consumidores legados existirem.
- `billingProviderEvents`: envelope normalizado e idempotente por `(provider, providerEventId)`.
- `billingEntitlements`: concessões próprias, patrocinadas, trial, transição, acesso somente para leitura, acesso gratuito configurado ou origem administrativa relacionada.
- `billingCapacityAllocations`: ocupação e liberação auditável de vagas profissionais por `coverageKey`.
- `billingAdminOverrides`: concessões manuais com motivo, vigência, autoria, revogação e histórico preservado.
- `billingAccessAuditEvents`: trilha append-only das mudanças de acesso e capacidade.
- `billingCoupons`: revisões imutáveis de cupom com política, vigência, limites, autoria e chave única para a revisão ativa do código.
- `billingCouponRedemptions`: reservas/confirmações vinculadas à revisão do cupom e à versão comercial, preservando o desconto histórico e coordenando concorrência.
- `billingCommercialAuditEvents`: trilha administrativa append-only para produto, versão e cupom.
- `whatsappConnections.activePhoneKey`: coluna gerada apenas para vínculos ativos e protegida por índice único, impedindo que o mesmo telefone ativo pertença a duas contas sem bloquear a preservação de registros desativados.

As migrations canônicas da fundação são `drizzle/0038_billing_foundation.sql`, `drizzle/0039_whatsapp_onboarding_activation.sql` e `drizzle/0040_whatsapp_active_phone_uniqueness.sql`. A evolução de catálogo da #891 usa `drizzle/0041_billing_catalog_versioning.sql`, preservando os IDs já referenciados por assinaturas e introduzindo identidade de produto, versão comercial e cupons. A última migration desativa duplicidades ativas históricas mantendo o vínculo ativo atualizado mais recentemente e, depois, instala a restrição única. Os workflows TiDB aplicam o schema, verificam drift do metadata Drizzle, exercitam concorrência/idempotência e rodam integridade referencial.

## Eventos do provider e minimização

O domínio não persiste payload bruto de webhook. Um provider futuro deve autenticar o corpo original, normalizar o evento e entregar ao repositório somente metadata permitida por `sanitizeBillingProviderEventMetadata`.

A lista permitida contém apenas identificadores operacionais, estado, motivo sanitizado, moeda, valor em unidade inteira, referências comerciais e instante do provider. Chaves de cartão, CVV, token, segredo, endereço, e-mail, telefone e objetos aninhados são descartados. A repetição do mesmo `providerEventId` retorna o evento já registrado, sem duplicar processamento.

## Elegibilidade e precedência

`getUserEntitlements(userId)` é o contrato central para web, tRPC e integrações. A precedência determinística e vinculante é:

1. isenção administrativa ativa;
2. cobertura válida por profissional;
3. assinatura própria paga ativa;
4. trial ativo;
5. período de transição ativo;
6. acesso somente para leitura ativo.

`free_access` permanece reservado ao modo de rollout aberto e a concessões gratuitas explicitamente configuradas; ele não substitui transição nem leitura.

A precedência define origem efetiva, atribuição de consumo e comunicação. Origens secundárias ainda válidas não são apagadas. Dentro da mesma origem, vence a concessão com maior validade; empate é resolvido pelo identificador da fonte. Registros futuros ou expirados são descartados defensivamente. A máquina canônica da #893 prevalece para o ciclo comercial: `active` concede acesso pago; `past_due` preserva acesso integral somente durante a carência vigente; `suspended` mantém apenas o entitlement técnico de leitura; `pending` sem trial ou transição e `expired` não concedem acesso por assinatura. Consumidores novos devem usar `billingSubscriptionLifecycle.state`, não inferir `suspended` a partir do campo legado `billingSubscriptions.status`.

Cobertura profissional exige simultaneamente assinatura ativa do patrocinador, vaga ativa, entitlement ativo e autorização profissional-paciente aprovada. Assinatura não substitui consentimento clínico.

## Matriz profissional combinada

Profissional e Profissional Plus concedem ao próprio pagador, em uma única assinatura, a matriz pessoal do Individual e a matriz profissional. O catálogo versionado persiste essa matriz combinada em `billingPlans.entitlementsJson` e persiste separadamente a matriz pessoal concedida ao paciente coberto em `billingPlans.coveredBeneficiaryEntitlementsJson`. Assim, uma evolução futura do Individual não altera silenciosamente benefícios de uma assinatura profissional já contratada.

Não é criada assinatura individual adicional, cobertura do profissional sobre si próprio ou cobrança duplicada. O uso pessoal do pagador profissional não chama reserva de capacidade e não ocupa vaga de paciente. Profissional e Plus diferem inicialmente somente pelo limite de capacidade.

## Aplicação progressiva no backend

`registerBillingAccessPolicy` registra uma política central sobre todas as `protectedProcedure`. Quando a elegibilidade é negada, a procedure é bloqueada no backend com erro seguro e explicável.

As procedures sob `billing.*` permanecem acessíveis para que o usuário autenticado consiga consultar sua situação e acompanhar a regularização. `auth.whatsappOnboarding.linkExistingAccount` é uma exceção exata e limitada, necessária para que uma conta autenticada ainda inelegível conclua o vínculo provado pelo token do WhatsApp. Procedures administrativas continuam usando `adminProcedure`, que valida `users.role = admin` independentemente da visibilidade da navegação.

No modo `open_access`, a policy preserva o comportamento atual. No modo `enforced`, a ausência de uma origem válida bloqueia os recursos protegidos. A ativação de `enforced` continua proibida até que catálogo, migração, comunicação e rollback estejam aprovados.

## WhatsApp e onboarding

O entrypoint do WhatsApp consulta o mesmo serviço de elegibilidade depois de identificar o usuário e antes de executar hidratação, refeição, exercício, confirmação ou qualquer outro pipeline nutricional.

Quando o acesso está pendente:

- a mensagem é removida do lote que seguiria para o pipeline;
- nenhum efeito nutricional é persistido;
- o usuário recebe orientação para consultar **Plano e acesso** no sistema web;
- o evento operacional é registrado sem texto cru, telefone ou detalhes financeiros sensíveis.

A conclusão do onboarding preserva estados recuperáveis, reavalia a elegibilidade e executa ativação posterior de modo idempotente. Conflitos com conta existente usam resposta pública genérica, preservam o lead e exigem sessão autenticada mais o token recebido no WhatsApp. A associação do lead, a troca do vínculo ativo e a unicidade do telefone são protegidas por transação e restrição de banco. Cadastro concluído sem elegibilidade permanece preservado e autenticado, mas segue para a página de situação comercial. Saudação e ativação são emitidas no máximo uma vez.

## Capacidade profissional

`configureBillingProfessionalEntitlementProvider` registra o provider canônico no contrato da Área Profissional. O módulo profissional consome recursos e capacidade, mas não consulta tabelas financeiras nem calcula limite.

Para planos com capacidade finita:

- a assinatura ativa é bloqueada na transação antes da contagem;
- a última vaga só pode ser ocupada por uma solicitação concorrente;
- `coverageKey` torna a reserva idempotente;
- ultrapassar o limite retorna `capacity_exceeded` e não cria cobertura parcial;
- falha da transição clínica dispara compensação pelo contrato profissional existente;
- liberação repetida é idempotente;
- revogação do vínculo pelo paciente nunca depende do sucesso da integração comercial para concluir a decisão clínica;
- o próprio pagador profissional nunca é representado como paciente coberto e não consome capacidade.

## Interfaces provider-neutral

A rota autenticada `/billing` apresenta origem efetiva, vigência, assinatura própria, plano profissional, capacidade e recursos retornados pelo backend sem inventar preço ou checkout.

A rota `/admin/billing` é protegida no frontend pelo papel administrativo e no backend por `adminProcedure`. Ela permite pesquisa, concessão e revogação de override, histórico e indicadores provider-neutral.

O frontend não mantém tabela comercial paralela, não calcula elegibilidade e não inventa preço, limite ou benefício.

## Administração

As procedures `billing.adminSearchUsers`, `billing.adminListOverrides`, `billing.adminGrantOverride`, `billing.adminRevokeOverride` e `billing.adminAnalytics` usam `adminProcedure`. A autoria é sempre obtida de `ctx.user.id`; o cliente não informa quem concedeu ou revogou.

## Contrato para provider financeiro futuro

`BillingProvider` define checkout hospedado, sincronização, cancelamento e autenticação/normalização de webhook. Nenhuma implementação real é registrada nesta entrega. O retorno do navegador não confirma acesso; ativação futura depende de estado confirmado pelo backend.

## Validação

- testes unitários discriminantes da precedência completa, validade e fallback;
- teste da matriz profissional combinada em uma única assinatura, sem reserva de capacidade pelo uso pessoal;
- teste discriminante do WhatsApp para usuário inelegível antes do pipeline nutricional;
- testes diretos da fronteira pública para não enumeração e exigência de sessão autenticada;
- teste TiDB de claim, ativação, retomada, disputa entre contas e rejeição de telefone ativo duplicado;
- teste TiDB de concorrência, idempotência, cobertura, overrides, analytics, evento duplicado e metadata sanitizada;
- `pnpm agent:check`;
- `pnpm build`;
- `pnpm db:test:billing` e `pnpm db:check-integrity` quando houver banco.

## Catálogo comercial versionado (#891)

O catálogo comercial é servido exclusivamente pelo backend. `billingProducts.code` é a identidade estável da família; cada linha de `billingPlans` é uma versão contratável imutável, com `versionCode`, número de versão, ciclo, preço, capacidade, recursos, meios de pagamento comercialmente autorizados, vigência e estado. Publicar uma versão nova encerra somente a janela de novas contratações da versão anterior; assinaturas existentes continuam referenciando seu `planId` original.

O seed inicial contém seis versões: Individual mensal/anual, Profissional mensal/anual e Profissional Plus mensal/anual. Os valores e capacidades seguem a #145. Profissional e Plus usam a mesma matriz de recursos combinada — recursos pessoais do Individual mais recursos profissionais — e diferem inicialmente apenas pela capacidade de 30 ou 100 pacientes. Cada versão profissional também congela a matriz pessoal dos pacientes cobertos. O uso pessoal do pagador profissional não cria cobertura sobre si mesmo nem reserva capacidade.

`commercialPaymentMethodsJson` registra apenas a política comercial (`credit_card` e `pix_automatic` no lançamento). `billing.catalog` devolve essa política separadamente de `effectivePaymentMethods`, que é calculado no backend pela interseção com as capacidades do adapter financeiro registrado. Sem adapter da #892, a lista efetiva permanece vazia; o frontend nunca amplia a política por conta própria.

Cupons são revisionados. Alterar uma política cria nova linha em `billingCoupons`, desativa a revisão anterior e mantém `billingCouponRedemptions` apontando para a revisão efetivamente aplicada. Percentual público é limitado a 30%; mensal aceita no máximo três cobranças; anual somente a primeira; desconto equivalente a 100% é rejeitado como cupom e pertence ao fluxo de isenção administrativa. A reserva de uso bloqueia a revisão ativa em transação, contabiliza reservas e confirmações e usa `contractKey` único para impedir estouro concorrente ou duplicação por retry.

Operações de catálogo e cupom usam `adminProcedure`; autoria vem de `ctx.user.id` e cada alteração exige motivo. Alertas `catalog_range_review_required` não possuem caminho de publicação automática: criar produto, criar versão, publicar, desativar e revisar cupom são ações administrativas explícitas.