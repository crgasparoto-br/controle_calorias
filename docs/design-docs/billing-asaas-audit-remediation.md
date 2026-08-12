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

Mutações de cancelamento e reativação que terminem com resultado remoto incerto são relidas no Asaas antes de qualquer nova mutação. Se a leitura comprovar que o efeito ocorreu, o ledger fecha como `created`; se comprovar que o efeito não ocorreu, a operação volta a `prepared` e exige uma nova chamada para executar o retry, mantendo uma única chamada outbound por tentativa. O reset do valor-base após o fim de um desconto segue o mesmo contrato: relê a assinatura, fecha quando o valor remoto coincide com o esperado ou reabre a operação quando a leitura comprova ausência do efeito. Atualização direta de cartão por token não é anunciada como capacidade enquanto não houver leitura autoritativa capaz de comprovar o resultado de um timeout; o backend deve usar um fluxo externo recuperável quando esse contrato estiver disponível.

As transições do ledger distinguem falha de transporte de encerramento autoritativo. Uma operação já `created` não pode regredir para `outcome_unknown` ou `failed` por resposta HTTP tardia; porém `CHECKOUT_EXPIRED`/`CHECKOUT_CANCELED` e uma autorização Pix cancelada, expirada ou recusada podem encerrar explicitamente a tentativa porque são fatos autoritativos do provider. Depois desse encerramento, respostas HTTP tardias também não podem reabrir ou reconfirmar a operação.

## Correlação do primeiro pagamento do Pix Automático

A Jornada 3 do Pix Automático retorna `immediateQrCode.conciliationIdentifier` junto da autorização. O mesmo identificador volta no objeto do primeiro pagamento liquidado e é a referência autoritativa para ligar esse pagamento à autorização que originou o QR.

A fronteira Asaas agora persiste essa relação antes de devolver o QR quando a contratação paga já possui `subscriptionId`: `conciliationIdentifier -> contractKey/subscriptionId/authorizationId`. O registro usa o mesmo ledger sanitizado e não persiste QR payload, corpo bruto nem segredo.

No recebimento de um webhook de pagamento com `conciliationIdentifier`, uma operação local `pix_payment` terminal e sem efeito financeiro próprio preserva `paymentId -> conciliationIdentifier`. Quando a relação principal já existe, o envelope entregue ao handler durável é enriquecido somente com `externalReference` e `pixAutomaticAuthorizationId` previamente correlacionados. Se o pagamento chegar antes da correlação principal, o sidecar permanece durável e a releitura posterior resolve a assinatura sem associar um identificador desconhecido a outro contrato.

A camada de webhook também aceita recuperar a correlação a partir de evento de autorização que traga `id`, `contractId` e `immediateQrCode.conciliationIdentifier`. Falha ao persistir a correlação antes do aceite do webhook retorna erro temporário, permitindo retry do provider em vez de confirmar um evento que perderia a chave de reconciliação.

Controles herméticos obrigatórios desta remediação:

- `PIX-CONCILIATION-001`: resposta de autorização com `conciliationIdentifier` é persistida antes do retorno do QR;
- `PIX-CONCILIATION-NEG-001`: autorização remota sem o identificador esperado vira resultado incerto quando existe assinatura local, evitando sucesso sem reconciliação;
- pagamento inicial fora de ordem permanece recuperável pelo sidecar durável;
- identificador desconhecido não herda `subscriptionId` de outra contratação.

## Contrato de link do Checkout e encerramentos terminais

O Asaas mantém documentação recente com duas formas de resposta de criação de Checkout: uma inclui `link`, outra descreve somente o `id` e a montagem de `https://asaas.com/checkoutSession/show?id=<id>`. O adapter aceita ambas. Um retorno somente com `id` não é classificado como falha local depois de criação remota bem-sucedida.

Eventos terminais usam os códigos autoritativos já emitidos pelo handler (`checkout_expired` e `authorization_closed`). No store, `markFailed` reconhece apenas esses pares de tipo/código como encerramento do provider, permite a transição `created -> failed` e persiste o marcador `provider_terminal:*`; transições ordinárias continuam protegidas contra regressão concorrente e não podem sobrescrever uma tentativa já encerrada pelo provider.

## Operação e sandbox

`docs/runbooks/billing-asaas.md` é o runbook canônico para fila interrompida, falhas consecutivas, `outcome_unknown`, divergência e validação live em sandbox. Credenciais reais não entram em PR, artefato ou GitHub Actions; a validação live é executada por operador autorizado em ambiente seguro e produz apenas evidência sanitizada vinculada ao SHA.

## Evidência de regressão

A remediação adiciona controles focados para:

- alinhamento do trial ao `firstChargeAt` autoritativo;
- repetição da mesma operação sem PUT duplicado;
- outcome incerto fechado por GET;
- cancelamento/reativação incertos fechados por leitura autoritativa;
- ausência comprovada do efeito reabre a operação para retry seguro em uma chamada posterior;
- `coupon_reset` incerto fechado por leitura do valor remoto, sem segundo PUT;
- estado `created` protegido contra falha/timeout tardio e encerramento terminal do provider protegido contra resposta HTTP tardia;
- resposta de Checkout somente com `id`, sem `link`;
- eventos terminais de Checkout e autorização Pix;
- cobrança de conversão antecipada já alinhada sem nova mutação;
- recuperação da `confirmationKey` por `paymentId`;
- callback hospedado permanecendo `pending`;
- correlação do primeiro pagamento Pix por `conciliationIdentifier`, incluindo chegada fora de ordem e controle negativo de identificador desconhecido.
