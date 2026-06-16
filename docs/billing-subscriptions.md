# Billing e assinaturas

Esta documentação cobre a fundação inicial do módulo de assinaturas criada para a issue #145.

## Estado atual

O projeto possui um módulo interno em `server/modules/billing` com:

- contratos de planos, assinaturas, eventos e status internos;
- provider interno para checkout externo;
- criação de checkout registrando assinatura local como `pending`;
- processamento administrativo de webhook com idempotência por `providerEventId`;
- helper para consultar se o usuário possui assinatura ativa;
- cancelamento marcado para o fim do período quando o provider inicial não informar outra regra.

Esta entrega ainda não escolhe Mercado Pago, Asaas ou outro provedor real. O provider atual usa uma URL externa configurável para preservar o contrato interno sem acoplar o produto a um gateway antes da decisão de negócio.

## Status internos

Os status internos padronizados são:

- `pending`: checkout criado ou pagamento aguardando confirmação;
- `active`: pagamento confirmado pelo backend;
- `past_due`: cobrança falhou ou está pendente após tentativa de renovação;
- `canceled`: assinatura cancelada sem acesso premium vigente;
- `expired`: período terminou sem renovação ativa.

O retorno visual do checkout não ativa assinatura. A ativação depende de processamento seguro no backend.

## Rotas tRPC

As procedures estão expostas em `billing`:

- `billing.plans`: lista planos ativos;
- `billing.checkout`: cria checkout externo para o usuário autenticado;
- `billing.subscription`: consulta assinatura do usuário autenticado;
- `billing.cancel`: solicita cancelamento da assinatura do usuário autenticado;
- `billing.processWebhook`: procedure administrativa para processar evento externo enquanto o endpoint público definitivo de webhook não é acoplado a um provider real.

## Variáveis de ambiente

### `BILLING_CHECKOUT_BASE_URL`

URL do checkout externo inicial. Quando ausente, `billing.checkout` retorna uma mensagem amigável informando que o checkout ainda não está configurado.

Exemplo de sandbox:

```bash
BILLING_CHECKOUT_BASE_URL="https://checkout.sandbox.exemplo.test/pay"
```

### `BILLING_PLANS_JSON`

Opcional. Permite configurar planos sem alterar código enquanto os planos definitivos não forem aprovados.

Exemplo:

```json
[
  {
    "id": "plan-plus-monthly",
    "code": "plus_monthly",
    "name": "Controle de Calorias Plus",
    "description": "Plano mensal com recursos premium.",
    "priceCents": 2990,
    "currency": "BRL",
    "billingCycle": "monthly",
    "provider": "external_checkout",
    "providerPlanId": "sandbox-plan-id",
    "active": true,
    "benefits": ["Recursos premium", "Histórico avançado"]
  }
]
```

## Sandbox

1. Configure `BILLING_CHECKOUT_BASE_URL` com uma URL de checkout hospedado de teste.
2. Configure `BILLING_PLANS_JSON` com os planos aprovados para teste.
3. Acesse o frontend futuro de assinatura ou chame `billing.checkout` autenticado.
4. Confirme que a assinatura local fica `pending`.
5. Simule um evento administrativo em `billing.processWebhook` com `externalStatus: "approved"`.
6. Confirme que a assinatura muda para `active`.
7. Reenvie o mesmo `providerEventId` e confirme que o evento é tratado como duplicado.

## Checklist de produção

Antes de habilitar cobrança real:

- escolher provedor inicial: Mercado Pago, Asaas ou outro;
- definir planos, preços, ciclos, benefícios e IDs no provedor;
- definir se cancelamento é imediato ou ao fim do período pago;
- definir quais funcionalidades premium serão protegidas primeiro;
- criar persistência versionada no Drizzle para planos, assinaturas e eventos;
- expor webhook público do provider escolhido com validação de autenticidade;
- validar webhook real em sandbox e produção;
- garantir que nenhum cartão, CVV ou dado sensível seja armazenado;
- atualizar a tela `/assinatura` quando os planos finais estiverem definidos.

## Pendências bloqueadas por decisão

A próxima etapa exige intervenção de produto/negócio para confirmar:

- provedor financeiro inicial;
- planos e preços iniciais;
- regra de cancelamento;
- funcionalidades premium protegidas;
- política de trial, cupom, plano gratuito ou migração.
