# Adapter Asaas para billing

## Escopo

Este documento registra o contrato técnico da issue #892. O Asaas é o primeiro provider financeiro real, mas permanece atrás da fundação provider-neutral de billing. O adapter não decide elegibilidade de trial, desconto, carência, suspensão, cobertura profissional ou precedência de acesso; ele executa operações financeiras, persiste correlação operacional, normaliza fatos externos e delega transições comerciais à máquina da #893.

`BILLING_ACCESS_MODE=open_access` continua sendo o padrão seguro. A presença do adapter não autoriza ativar cobrança obrigatória em produção.

## Configuração e separação de ambientes

`ASAAS_ENV=sandbox|production` seleciona o ambiente. O padrão é `sandbox`. Credenciais são deliberadamente separadas para impedir o uso acidental de um segredo de produção no sandbox:

- `ASAAS_SANDBOX_API_KEY`
- `ASAAS_SANDBOX_WEBHOOK_TOKEN`
- `ASAAS_PRODUCTION_API_KEY`
- `ASAAS_PRODUCTION_WEBHOOK_TOKEN`
- `ASAAS_ENABLED_PAYMENT_METHODS=credit_card,pix_automatic`
- `ASAAS_REQUEST_TIMEOUT_MS=60000`
- `ASAAS_RECONCILIATION_INTERVAL_MS=300000`

API keys e tokens de webhook são backend-only e nunca podem usar prefixo `VITE_`. O catálogo só anuncia métodos efetivos quando API key **e** token de webhook do ambiente ativo existem. Sem esse par, `billing.catalog.effectivePaymentMethods` permanece vazio.

O webhook deve ser cadastrado no Asaas apontando para `POST /api/billing/asaas/webhook` e usar como access token exatamente o segredo correspondente ao ambiente ativo.

## Idempotência local-first

Antes de qualquer operação financeira mutável, o backend persiste uma operação local no ledger durável `billingProviderEvents`, com `providerEventId` sintético e hashado (`local:<kind>:<sha256>`). O payload persistido passa pela allowlist de `providerEvents.ts`; body bruto, número do cartão, CVV, token de cartão, API key e token de webhook não são persistidos.

Estados operacionais:

1. `prepared`: a operação foi registrada e pode fazer a sua única chamada outbound;
2. `created`: a resposta remota foi persistida e retries locais viram no-op/reuso;
3. `outcome_unknown`: a chamada pode ter criado efeito remoto; somente leitura/reconciliação é permitida;
4. `failed`: falha determinística; não existe retry automático da mutação.

O cliente HTTP não possui retry oculto. Timeout ou falha de transporte após um POST/PUT/DELETE tornam o resultado incerto. O backend nunca “corrige” esse caso repetindo cegamente a mutação.

## Customer

O customer Asaas usa `externalReference=controle-calorias:user:<userId>`. A operação é preparada antes do POST. Se a resposta do POST for incerta, uma tentativa posterior executa somente `GET /customers?externalReference=...`; um único match fecha a operação, zero matches mantém reconciliação pendente e múltiplos matches viram ambiguidade operacional.

O customer pode ser criado inicialmente com dados mínimos server-side. Para trial de cartão, CPF/CNPJ e telefone usados pela proteção anti-repetição são relidos do customer Asaas depois de o checkout recorrente gerar a assinatura; esses valores não são persistidos pelo adapter.

## Cartão e Checkout hospedado

Cartão usa Checkout hospedado recorrente com `billingTypes=[CREDIT_CARD]`, `chargeTypes=[RECURRENT]`, customer existente e `externalReference=contractKey`. O callback serve apenas para navegação e permanece `pending`; ele nunca confirma pagamento nem ativa acesso.

Para trial, a intenção financeira do checkout é criada antes da assinatura local. Quando `SUBSCRIPTION_CREATED` chega por webhook, o backend:

1. correlaciona a operação pelo `contractKey`;
2. relê o customer Asaas;
3. usa a assinatura criada pelo checkout como prova provider-side de instrumento de cartão registrado;
4. chama `startContract` da #893 com identidade anti-repetição;
5. persiste `externalSubscriptionId`/`externalCustomerId` somente depois da correlação local.

Se a #893 negar o trial ou a identidade obrigatória não puder ser validada, a assinatura remota é desativada e nenhum acesso é concedido.

O `nextDueDate` do checkout de trial inclui margem adicional além da duração do trial para que o checkout, que pode ser concluído depois de sua criação, não gere uma cobrança antes da fronteira `firstChargeAt` local.

## Cupom e duração finita

O adapter recebe apenas desconto já validado pelo catálogo. Ele não reavalia regras comerciais. A reserva usa `contractKey`, portanto a reserva feita antes do checkout e a confirmação posterior pela #893 são idempotentes.

No cartão, o checkout recorrente começa com o valor efetivo. Cada pagamento confirmado é contado por `paymentId` em uma operação local `coupon_charge`. Quando o número de cobranças descontadas atinge `durationCharges`, uma única operação `coupon_reset` atualiza o valor da assinatura para o preço-base, afetando apenas cobranças futuras.

No Pix Automático, cada cobrança futura é criada separadamente, então o scheduler escolhe entre valor descontado e valor-base conforme a contagem de cobranças confirmadas. Uma cobrança final com valor zero nunca é enviada ao Asaas; o domínio deve resolver um benefício de 100% antes da fronteira provider.

## Pix Automático

`pix_automatic` é distinto de Pix manual e não concede trial. A renúncia ao trial precisa ser explícita antes de qualquer chamada ao provider.

A autorização usa `paymentCreationMode=MANUAL`, QR imediato para a primeira cobrança e **não** fixa valor recorrente na autorização. A autorização, o QR e o callback não ativam acesso; somente fatos financeiros autoritativos enviados à #893 podem fazê-lo.

Depois de um pagamento confirmado, o backend apenas agenda a próxima cobrança no ledger local. O POST `/payments` é executado depois, quando:

- a autorização já recebeu evento de ativação e existe marcador local durável;
- a cobrança entrou em uma janela conservadora de 2 a 6 dias úteis por contagem de dias de semana, que fica dentro da janela operacional documentada pelo provider de 2 a 10 dias úteis;
- a operação ainda está `prepared`.

A contagem local não tenta reproduzir feriados bancários. Por isso usa uma subjanela conservadora; o Asaas continua sendo a autoridade final e uma rejeição determinística não é repetida automaticamente.

Se o POST de uma cobrança futura terminar com resultado incerto, a próxima tentativa faz somente consulta por `externalReference`. Ela nunca emite outro POST até a reconciliação fechar o resultado anterior.

## Webhook e fila recuperável

`POST /api/billing/asaas/webhook` recebe `application/json` como bytes crus com limite de 128 KiB. O header `asaas-access-token` é validado por comparação timing-safe antes do parse e antes de qualquer efeito persistente.

Depois da autenticação:

- `id` externo é persistido com unicidade `(provider, providerEventId)`;
- somente metadata allowlisted necessária para replay é salva;
- o body bruto não é salvo;
- HTTP 200 é devolvido depois da persistência;
- processamento ocorre sobre o registro persistido, não sobre o objeto JSON em memória;
- duplicatas retornam sucesso sem repetir efeito;
- `failed/correlation_pending` e falhas transitórias ficam reprocessáveis pelo reconciliador;
- eventos desconhecidos ficam `ignored/unknown_event`, sanitizados e sem conceder acesso.

Isso mantém o processamento recuperável após reinício do processo.

## Normalização financeira

Eventos financeiros são traduzidos para `BillingProviderNeutralFinancialFact` e entregues à #893. O `paymentId` é usado como `competenceKey`, de forma que múltiplos eventos relativos à mesma cobrança não avancem a assinatura duas vezes.

Mapeamento principal:

- `PAYMENT_AUTHORIZED` -> `authorization_confirmed`;
- `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` -> `payment_confirmed`;
- captura recusada -> `payment_refused`;
- overdue e análise de risco recusada -> `payment_failed`;
- instrução Pix recusada isoladamente permanece operacional/reconciliável; a falha financeira é aplicada somente quando chegar um fato autoritativo final, como `PAYMENT_OVERDUE`;
- autorização Pix recorrente cancelada, expirada ou recusada encerra a tentativa local como `attempt_expired`, sem conceder acesso e liberando a reserva de cupom.
- chargeback/refund -> `chargeback_confirmed`.

Evento de autorização Pix ativa apenas o marcador operacional de autorização. Evento de assinatura apenas cria correlação. Nenhum desses eventos concede acesso diretamente.

Eventos fora de ordem ou pagamentos tardios são decididos pela máquina provider-neutral da #893. O adapter nunca regride estado por conta própria e nunca cria uma nova cobrança para compensar falha local ocorrida depois de confirmação financeira.

## Reconciliação

Há dois caminhos:

- automática: scheduler processa webhooks `received/failed` recuperáveis e cobranças Pix agendadas;
- manual: `pnpm exec tsx scripts/reconcile-asaas-billing.ts [contractKey]` reprocessa a fila ou consulta uma assinatura por `externalReference` para recuperar um checkout com resultado local incompleto.

Reconciliação usa leitura autoritativa e não implica retry de mutação.

## Operações financeiras expostas pelo runtime

O runtime fornece operações server-side para:

- preparar um fluxo de pagamento;
- consultar/sincronizar assinatura e próxima renovação;
- solicitar cancelamento de renovação;
- reativar renovação de cartão quando ainda suportada pelo contrato local;
- atualização direta de cartão por token não é anunciada como capacidade enquanto o resultado de um timeout não puder ser confirmado por leitura autoritativa; um fluxo externo recuperável deve ser usado quando esse contrato for implementado;
- cancelar autorização Pix;
- reconciliar uma tentativa por `contractKey`.

Mutações financeiras adicionais usam o mesmo ledger local-first. Reativação de Pix Automático não é simulada: quando a autorização foi cancelada, o runtime exige uma nova autorização.

## Segurança e observabilidade

- segredos nunca são logados;
- erros HTTP persistem apenas estado/código seguro, nunca resposta crua;
- dados de cartão e CVV não passam pelo banco do Controle de Calorias;
- token de atualização de cartão não é persistido no ledger;
- logs operacionais usam apenas IDs internos/sanitizados e classe do erro;
- sandbox e produção têm segredos distintos;
- `BILLING_ACCESS_MODE=open_access` continua sendo o padrão até um rollout explicitamente aprovado.

## Validação mínima

- customer/checkout idempotentes com transporte fake;
- uma tentativa mutável = uma chamada outbound e ausência de retry oculto;
- timeout de POST bloqueia recriação cega;
- método desabilitado, Pix com trial e charge zero falham antes de outbound;
- Pix usa autorização `MANUAL`, sem valor recorrente fixo;
- cobrança Pix futura é apenas agendada até entrar na janela operacional;
- webhook exige token exato e sanitiza metadata;
- CI deve executar os gates definidos pelo repositório, incluindo TypeScript, testes, arquitetura, documentação, build e `pnpm agent:check`.
