# Remediação da auditoria do adapter Asaas (#892)

Este documento complementa `billing-asaas-adapter.md` para registrar o fechamento dos achados da auditoria da issue #892 sem transferir regras comerciais para o provider.

## Autoridade temporal do trial

O `nextDueDate` criado inicialmente no Checkout hospedado continua sendo uma proteção provisória enquanto a assinatura local ainda não existe. Depois de `SUBSCRIPTION_CREATED`, o `startContract` provider-neutral da #893 persiste o contrato e define `firstChargeAt`; essa data passa a ser a autoridade temporal.

O hook Asaas pós-`startContract` consulta a cobrança pendente da assinatura e alinha a parcela e a próxima data da assinatura exatamente a `firstChargeAt`. As mutações usam o ledger local-first e são idempotentes. Resultado remoto incerto fica `outcome_unknown`; o retry faz somente leitura autoritativa antes de concluir, sem repetir PUT cegamente.

## Efetivação antecipada profissional

A efetivação antecipada usa a assinatura de cartão já criada durante o trial:

1. a confirmação comercial provider-neutral valida produto, versão, ciclo, moeda, preço, capacidade, `firstChargeAt` e `confirmationKey`;
2. a cobrança pendente da assinatura é alinhada para a data explicitamente confirmada e recebe `externalReference=<contractKey>:early_conversion`;
3. o ledger `payment_reschedule` correlaciona `paymentId`, assinatura e `confirmationKey`;
4. callback de navegador e autorização isolada continuam sem conceder acesso;
5. quando `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` chega, o `paymentId` recupera a `confirmationKey` persistida e enriquece o fato provider-neutral antes da máquina da #893;
6. somente esse fato financeiro autoritativo pode encerrar o trial e ampliar capacidade.

Se a alteração remota tiver resultado incerto, a tentativa seguinte executa GET do pagamento e fecha o ledger apenas quando vencimento, valor e `externalReference` coincidirem. Não há segundo PUT automático.

## Continuidade e reinício

Os hooks são registrados no startup normal e no comando de reconciliação administrativa. A correlação necessária para retomar processamento não depende de memória do callback: ela permanece em `billingProviderEvents`, permitindo replay após reinício sem duplicar cobrança, confirmação comercial ou transição.

Mutações de cancelamento e reativação que terminem com resultado remoto incerto são relidas no Asaas antes de qualquer nova mutação. Se a leitura comprovar que o efeito ocorreu, o ledger fecha como `created`; se comprovar que o efeito não ocorreu, a operação volta a `prepared` e exige uma nova chamada para executar o retry, mantendo uma única chamada outbound por tentativa. O reset do valor-base após o fim de um desconto segue o mesmo contrato: relê a assinatura, fecha quando o valor remoto coincide com o esperado ou reabre a operação quando a leitura comprova ausência do efeito. Atualização direta de cartão por token não é anunciada como capacidade enquanto não houver leitura autoritativa capaz de comprovar o resultado de um timeout; o backend deve usar um fluxo externo recuperável quando esse contrato for implementado.

As transições do ledger são monotônicas para efeitos confirmados: uma operação já marcada como `created` não pode regredir para `outcome_unknown` ou `failed` por uma resposta HTTP tardia concorrendo com webhook/reconciliação.

## Evidência de regressão

A remediação adiciona controles focados para:

- alinhamento do trial ao `firstChargeAt` autoritativo;
- repetição da mesma operação sem PUT duplicado;
- outcome incerto fechado por GET;
- cancelamento/reativação incertos fechados por leitura autoritativa;
- ausência comprovada do efeito reabre a operação para retry seguro em uma chamada posterior;
- `coupon_reset` incerto fechado por leitura do valor remoto, sem segundo PUT;
- estado `created` protegido contra regressão concorrente;
- cobrança de conversão antecipada já alinhada sem nova mutação;
- recuperação da `confirmationKey` por `paymentId`;
- callback hospedado permanecendo `pending`.
