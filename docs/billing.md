# Billing e assinaturas

O módulo de billing permite iniciar uma assinatura por checkout externo, registrar a assinatura local como `pending` e liberar acesso premium somente depois de um webhook confirmado pelo backend.

## Provedor

A primeira implementação usa um provider interno de checkout hospedado configurável por ambiente. Ele isola o app de detalhes específicos do provedor e permite trocar a integração para Mercado Pago, Asaas ou outro provedor sem alterar a tela de assinatura nem os helpers de acesso premium.

Valores aceitos em `BILLING_PROVIDER`:

- `sandbox` para desenvolvimento e testes locais.
- `mercadopago` para integração futura com Mercado Pago.
- `asaas` para integração futura com Asaas.

## Variáveis de ambiente

```txt
BILLING_PROVIDER=sandbox
BILLING_CHECKOUT_BASE_URL=https://checkout.example.invalid/controle-calorias
BILLING_WEBHOOK_SECRET=troque-este-segredo
BILLING_PLAN_PRO_MONTHLY_CENTS=2990
BILLING_PLAN_PRO_YEARLY_CENTS=29900
BILLING_PROVIDER_PLAN_PRO_MONTHLY_ID=provider-plan-monthly-id
BILLING_PROVIDER_PLAN_PRO_YEARLY_ID=provider-plan-yearly-id
```

`BILLING_WEBHOOK_SECRET` é usado para validar o cabeçalho `x-billing-signature`. Quando o segredo está configurado, o webhook sem assinatura válida é rejeitado.

## Endpoints e rotas

Rotas tRPC autenticadas:

- `billing.plans`: lista planos ativos.
- `billing.subscription`: retorna status da assinatura do usuário atual.
- `billing.checkout`: cria checkout externo e assinatura local `pending`.
- `billing.cancel`: solicita cancelamento local, por padrão ao fim do período pago.

Endpoint HTTP para provedores externos:

```txt
POST /api/billing/webhooks/:provider
```

Exemplo de `:provider`: `sandbox`, `mercadopago` ou `asaas`.

## Payload de webhook

Formato normalizado esperado pelo backend:

```json
{
  "providerEventId": "evt_123",
  "eventType": "payment.approved",
  "providerSubscriptionId": "sub_123",
  "providerCustomerId": "cus_123",
  "status": "approved",
  "planCode": "pro_mensal",
  "userId": 1,
  "paymentMethodLabel": "Pix"
}
```

O status externo é convertido para os status internos:

- `pending`
- `active`
- `past_due`
- `canceled`
- `expired`

Webhooks duplicados são identificados por `provider + providerEventId` e não reprocessam a assinatura.

## Sandbox

1. Configure `BILLING_PROVIDER=sandbox`.
2. Configure `BILLING_CHECKOUT_BASE_URL` com uma URL de checkout hospedado de teste.
3. Acesse `/assinatura` com usuário autenticado.
4. Escolha um plano para criar uma assinatura `pending`.
5. Simule um webhook para `/api/billing/webhooks/sandbox` com `status=approved`.
6. Confira se `billing.subscription` retorna `active`.

## Checklist de produção

- Escolher provedor inicial: Mercado Pago, Asaas ou outro.
- Criar planos no provedor e preencher os IDs em `BILLING_PROVIDER_PLAN_*`.
- Configurar URL pública do webhook no painel do provedor.
- Definir e proteger `BILLING_WEBHOOK_SECRET`.
- Confirmar quais eventos do provedor equivalem a pagamento aprovado, falha de cobrança, cancelamento e expiração.
- Trocar o repositório local por persistência durável antes de depender do módulo em produção multi-instância.
- Definir quais funcionalidades serão premium antes de aplicar `requireActiveSubscription` em fluxos existentes.

## Helpers premium

O backend expõe helpers no módulo `server/modules/billing/billingService.ts`:

```ts
getUserSubscriptionStatus(userId)
userHasActiveSubscription(userId)
requireActiveSubscription(userId)
```

O uso básico do app permanece liberado. Para proteger uma funcionalidade premium, aplique `requireActiveSubscription` no ponto de entrada do backend dessa funcionalidade e mantenha uma mensagem clara para o usuário final.

## Dados sensíveis

O sistema não armazena cartão, CVV ou dados sensíveis de pagamento. O checkout deve acontecer fora da aplicação, no provedor configurado.
