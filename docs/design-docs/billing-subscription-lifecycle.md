# Ciclo de vida provider-neutral de assinaturas

## Escopo

Este documento registra o contrato técnico da issue #893. Ele complementa `billing-foundation.md` e o catálogo versionado da #891 sem implementar checkout, adapter financeiro real, telas ou a política detalhada de cobertura da #894.

Para a semântica de ciclo de vida e de acesso derivado dos estados de assinatura, este documento substitui as descrições pré-#893 de `billing-foundation.md`. Os demais fundamentos daquele documento continuam válidos.

A máquina canônica persiste os estados `pending`, `active`, `past_due`, `suspended` e `expired` em `billingSubscriptionLifecycle`. A intenção de cancelamento não é um sexto estado: ela permanece em `billingSubscriptions.cancelAtPeriodEnd` até o encerramento efetivo.

`billingSubscriptions.status` continua existindo como campo de compatibilidade da fundação anterior. Enquanto consumidores legados ainda dependerem dele, `suspended` é representado ali como `past_due`; decisões novas de ciclo de vida devem consultar o estado canônico.

## Contratação e trial

- somente `credit_card` e `pix_automatic` podem chegar ao domínio, conforme a versão comercial;
- trial é permitido somente com cartão;
- Pix Automático exige `trialChoice=waive`; a renúncia fica persistida em `billingContractIntents.trialWaivedAt` antes de qualquer confirmação financeira;
- trial Individual dura 7 dias;
- trial Profissional dura 14 dias e limita a capacidade a 5 pacientes;
- período de transição/migração e trial não são somados: o trial mantém seu relógio próprio e a primeira cobrança fica para o dia posterior ao maior prazo protegido;
- pagamento antecipado somente ativa antes de `firstChargeAt` quando o fato autoritativo estiver marcado como conversão antecipada; caso contrário o domínio exige reconciliação.

A prevenção de trial repetido usa claims persistentes e imutáveis por audiência sobre usuário interno, telefone normalizado e CPF/CNPJ aplicável. O domínio armazena somente HMAC-SHA256 do identificador, calculado com `BILLING_TRIAL_IDENTITY_SECRET`; e-mail, cookie, browser e valores crus de CPF/CNPJ/telefone não são usados como chave de elegibilidade.

`TrialIdentityInput` é um contrato interno do backend. O adapter que iniciar uma contratação deve resolver usuário, telefone e CPF/CNPJ a partir de fontes persistidas/verificadas no servidor; valores de identidade enviados livremente pelo cliente não podem ser usados como prova de elegibilidade para trial.

Claims sobrevivem ao encerramento ou exclusão da assinatura. Colisão ou falta de identidade suficiente gera decisão auditável e não concede trial silenciosamente.

## Confirmação financeira e idempotência

O domínio recebe `BillingProviderNeutralFinancialFact`, e não payload de provider. Cada fato carrega identificador idempotente do provider, assinatura, tipo normalizado, instante autoritativo, competência e correlação.

- confirmação de pagamento ativa ou renova somente a competência correspondente;
- repetição do mesmo evento é no-op idempotente;
- fato com `occurredAt` anterior ao último fato autoritativo não regride o estado;
- confirmação tardia depois de `expired` não reativa automaticamente: marca reconciliação obrigatória;
- confirmação anterior à primeira cobrança esperada, sem conversão antecipada explícita, também exige reconciliação;
- cupom reservado é confirmado somente quando a contratação é efetivamente confirmada e é cancelado quando a tentativa termina sem contrato.

## Inadimplência, suspensão e recuperação

Falha/refusa da cobrança de uma assinatura ativa, ou da primeira cobrança pós-trial, entra em `past_due` com 7 dias corridos de carência. Durante a carência, o acesso integral permanece válido.

O outbox registra, no máximo uma vez por janela:

- entrada em `past_due`;
- aviso no dia 0;
- aviso no dia 2;
- aviso no dia 5;
- aviso no dia 7.

Confirmação de pagamento durante a carência reativa/regulariza a assinatura e invalida avisos de inadimplência ainda não enviados. O mesmo vale para recuperação durante a janela posterior de 30 dias.

Ao terminar a carência, a assinatura entra em `suspended`:

- o usuário Individual recebe apenas o entitlement técnico de leitura (`system_access`, `web_access`, `reports`) para consultar/exportar dados e administrar cobrança;
- o Profissional deixa de obter capacidade contratável para novos pacientes;
- alocações de capacidade já existentes não são liberadas automaticamente;
- pacientes cobertos deixam de receber acesso patrocinado enquanto o patrocinador está suspenso;
- um fato `coverage_pause_requested` é publicado para integração posterior com a #894.

A janela de recuperação dura 30 dias. Pagamento confirmado dentro dela volta a mesma assinatura para `active`, preservando versão, preço e ciclo, sem novo trial. Para plano Profissional, o domínio publica `coverage_restore_requested`. A transição também publica `subscription_recovered` mesmo quando o pagamento de recuperação for a primeira competência paga da assinatura. Depois da janela, o estado vira `expired`; uma cobrança tardia requer reconciliação e uma nova contratação deve usar termos comerciais atuais.

## Cancelamento e encerramento administrativo

Cancelamento normal desliga renovação automática e mantém o acesso até o fim do trial ou período corrente. Se a assinatura já estiver em `past_due`, a solicitação de cancelamento não encurta a carência vigente; se houver recuperação posterior, a intenção de não renovar permanece registrada. Antes do limite aplicável, o assinante pode reativar a renovação.

Uma tentativa `pending` sem trial e sem período confirmado pode ser abandonada imediatamente, encerrando a tentativa e liberando a reserva de cupom.

Encerramento imediato é restrito aos motivos `fraud`, `chargeback`, `security_risk`, `legal_obligation`, `full_refund_approved` e `operational_error`. Extensão administrativa de carência e encerramento imediato revalidam `users.role = admin` dentro da mesma transação que aplica a mutação e persistem auditoria com ator, motivo e metadados mínimos.

## Outbox de fatos e comunicação

`billingSubscriptionFacts` é a fronteira provider-neutral para comunicação e integrações posteriores. A máquina nunca envia WhatsApp, e-mail ou push diretamente.

Cada fato possui versão, `idempotencyKey`, `correlationId`, pagador, audiência, produto, versão comercial, ciclo, estado anterior/novo, instante efetivo e ação permitida. O payload é allowlisted pelo produtor e não inclui valor da cobrança, método de pagamento, cartão, token, CPF/CNPJ, telefone ou payload bruto do provider.

Os fatos mínimos cobrem trial iniciado/terminando, contratação pendente/confirmada/recusada/expirada, renovação, entrada e avisos de inadimplência, suspensão, recuperação, expiração e cancelamento solicitado/reativado/efetivo. Fatos obsoletos de inadimplência podem ser marcados como invalidados antes do envio quando um pagamento resolve a condição.

Falha futura no transporte de comunicação não altera estado financeiro: estado e outbox são persistidos primeiro e consumidores externos executam depois.

## Persistência

A migration `drizzle/0042_billing_subscription_lifecycle.sql` introduz:

- `billingContractIntents`: chave idempotente de tentativa, método, escolha de trial e reserva de cupom;
- `billingSubscriptionLifecycle`: estado canônico, revisão otimista e relógios de trial/carência/recuperação;
- `billingTrialIdentityClaims`: hashes persistentes que impedem repetição de trial;
- `billingTrialEligibilityAuditEvents`: decisões de elegibilidade sem identificadores crus;
- `billingSubscriptionFacts`: outbox versionado e idempotente;
- `billingSubscriptionLifecycleAuditEvents`: mudanças administrativas e reconciliações auditáveis.

O repository usa transação, lock das entidades críticas, revisão otimista e unicidade do evento financeiro para impedir regressão, dupla confirmação e duplicação de fatos.

## Integração com acesso e capacidade

`createDrizzleBillingRepository` compõe adaptadores de acesso/capacidade da fundação com a máquina nova:

- `past_due` ainda produz acesso de assinatura durante a carência;
- trial profissional é exposto ao provider da Área Profissional com capacidade 5;
- reservas durante trial/carência usam a mesma tabela de capacidade e o mesmo `coverageKey` idempotente;
- `suspended` não aceita novas reservas, mas não libera as existentes;
- a Área Profissional continua consumindo o contrato central de entitlement, sem ler tabelas financeiras diretamente.

## Configuração

`BILLING_TRIAL_IDENTITY_SECRET` deve ser um segredo backend-only com pelo menos 32 caracteres antes de qualquer concessão de trial. Ausência ou valor curto falha fechado. O segredo não deve usar prefixo `VITE_`, não deve ser logado e não deve ser reutilizado como token de provider.

## Validação

- testes unitários usam relógio controlado e provider fake determinístico;
- o teste TiDB `scripts/test-billing-subscription-lifecycle-tidb.ts` cobre concorrência de identidade, idempotência de provider, evento fora de ordem, carência, suspensão, expiração, reconciliação tardia e capacidade profissional 5;
- o workflow `Billing persistence TiDB gate` executa esse teste junto ao gate de billing existente;
- `pnpm agent:check`, `pnpm build`, drift Drizzle e integridade referencial permanecem gates obrigatórios do candidato.
