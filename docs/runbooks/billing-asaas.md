# Runbook operacional do billing Asaas

## Finalidade

Este é o runbook canônico da integração Asaas da issue #892. Ele cobre recuperação de webhook, reconciliação, `outcome_unknown`, encerramentos de Checkout/Pix Automático e o gate live de sandbox. Não autoriza cobrança em produção nem alteração de segredos por si só.

`BILLING_ACCESS_MODE=open_access` deve permanecer o padrão até rollout explicitamente aprovado pela épica de billing.

## Invariantes operacionais

1. callback do navegador é somente navegação e nunca confirma pagamento;
2. webhook autenticado ou leitura autoritativa do provider é a fonte de verdade financeira;
3. uma tentativa mutável não é repetida cegamente depois de timeout;
4. `outcome_unknown` exige leitura/reconciliação antes de nova mutação;
5. `CHECKOUT_EXPIRED`/`CHECKOUT_CANCELED` e autorização Pix cancelada, expirada ou recusada encerram a tentativa;
6. resposta HTTP tardia não pode reabrir uma tentativa terminal nem regredir uma operação confirmada;
7. payload bruto, cartão, CVV, API key e token de webhook não entram em banco, log, issue, PR ou evidência;
8. sandbox e produção usam credenciais separadas.

## Configuração

Ambiente ativo:

```text
ASAAS_ENV=sandbox|production
ASAAS_SANDBOX_API_KEY=...
ASAAS_SANDBOX_WEBHOOK_TOKEN=...
ASAAS_PRODUCTION_API_KEY=...
ASAAS_PRODUCTION_WEBHOOK_TOKEN=...
ASAAS_ENABLED_PAYMENT_METHODS=credit_card,pix_automatic
ASAAS_REQUEST_TIMEOUT_MS=60000
ASAAS_RECONCILIATION_INTERVAL_MS=300000
```

Segredos são backend-only e nunca usam prefixo `VITE_`. Para qualquer validação desta integração em PR, use testes herméticos/fakes. Não crie workflow, `workflow_dispatch`, Environment ou aprovação manual para expor credenciais reais a código de PR.

## Sinais e diagnóstico

| Sinal | Interpretação provável | Ação inicial |
| --- | --- | --- |
| webhooks em `received` por tempo anormal | worker/reconciliação não processou | executar reconciliação administrativa e revisar logs sanitizados |
| `failed/correlation_pending` repetido | evento chegou antes da correlação local | reconciliar o contrato/assinatura; não criar cobrança substituta |
| `failed/processing_failed` consecutivo | falha recuperável no processamento | identificar classe do erro, corrigir causa e reprocessar pelo reconciliador |
| operação local `outcome_unknown` | mutação pode ter ocorrido no Asaas | somente GET/reconciliação; nunca repetir POST/PUT/DELETE cegamente |
| Checkout ou autorização Pix terminal | tentativa encerrada no provider | oferecer nova tentativa com nova intenção/contrato; não reutilizar objeto terminal |
| divergência local x Asaas | estado não pode ser decidido com segurança | manter `pending`, coletar leitura autoritativa e reconciliar |

Logs devem conter somente IDs internos/sanitizados e classe de erro. Nunca registrar headers, corpo bruto, API key, token de webhook ou dados de cartão.

## Reconciliação administrativa

Para processar a fila recuperável e cobranças Pix agendadas:

```bash
pnpm exec tsx scripts/reconcile-asaas-billing.ts
```

Para uma tentativa específica correlacionada por `contractKey`:

```bash
pnpm exec tsx scripts/reconcile-asaas-billing.ts '<contractKey>'
```

O comando deve ser executado com o mesmo ambiente/configuração da aplicação. Reconciliação não significa repetir mutação: o código consulta o provider e só fecha/reabre a operação quando a leitura autoritativa permitir.

## Fila de webhook interrompida ou falhas consecutivas

1. confirme se o endpoint `POST /api/billing/asaas/webhook` está disponível;
2. confirme que o token configurado pertence ao ambiente selecionado, sem imprimi-lo;
3. verifique apenas contagens/IDs sanitizados de `billingProviderEvents` com `status=received` ou `failed`;
4. execute a reconciliação administrativa;
5. se `correlation_pending` permanecer, reconcilie o `contractKey` correspondente antes de qualquer mutação;
6. se a falha for determinística do provider, mantenha a tentativa fechada e ofereça nova intenção ao usuário;
7. se houver risco de evento perdido, compare assinatura/cobrança diretamente por leitura autoritativa antes de tomar decisão local.

Não reenvie manualmente o mesmo efeito financeiro para “destravar” a fila.

## Timeout e `outcome_unknown`

Quando POST/PUT/DELETE falhar por transporte depois de possivelmente alcançar o Asaas:

1. mantenha a operação `outcome_unknown`;
2. na tentativa seguinte, execute a leitura de reconciliação definida para a operação;
3. se o efeito remoto existir, marque a operação como concluída sem nova mutação;
4. se a leitura provar que o efeito não ocorreu, reabra para `prepared` e faça o retry somente em uma chamada posterior;
5. se a leitura for inconclusiva, mantenha `pending` e escale.

Para criação incerta de autorização Pix Automático, a leitura administrativa/automática percorre a listagem inteira do cliente por `offset` até `hasMore=false`, comparando o `contractId` persistido. Não conclua ausência pela primeira página: match posterior fecha a operação, matches distintos em páginas diferentes exigem intervenção por ambiguidade e nenhum desses caminhos repete o POST da autorização.

## Checkout expirado/cancelado

`CHECKOUT_EXPIRED`, `CHECKOUT_CANCELED` e `CHECKOUT_CANCELLED` são terminais para aquela tentativa. O backend registra o encerramento autoritativo mesmo se a criação já estava `created`. Uma resposta HTTP tardia não pode reconfirmar o Checkout.

Uma nova tentativa deve usar uma nova intenção/`contractKey`; não reutilize a URL expirada ou cancelada.

## Pix Automático cancelado/expirado/recusado

Autorizações Pix Automático terminais encerram a tentativa e liberam a reserva de cupom aplicável. Não agende nova cobrança para uma autorização terminal. Reativação exige nova autorização; não simule reativação alterando apenas o estado local.

## Gate live de sandbox antes da liberação

A validação live é um gate operacional e deve ocorrer fora de GitHub Actions com credenciais já custodiadas no ambiente seguro do responsável. Nunca copie segredos para issue, PR, chat, log ou artefato.

### Pré-condições

- SHA candidato identificado;
- gates herméticos do repositório verdes;
- `ASAAS_ENV=sandbox`;
- `ASAAS_SANDBOX_API_KEY` e `ASAAS_SANDBOX_WEBHOOK_TOKEN` configurados apenas no ambiente seguro;
- `BILLING_ACCESS_MODE=open_access`;
- usuário/cliente sintético dedicado ao sandbox;
- endpoint de webhook sandbox apontando para a instância de teste.

### Cenários obrigatórios

1. **Cartão / Checkout:** criar Checkout recorrente e confirmar que a resposta real do sandbox é aceita, a URL abre o Checkout e o estado local permanece `pending` até fato financeiro. O formato alternativo `id`-only é obrigatório no gate hermético (`adapter.test.ts`) porque o provider pode retornar somente uma das variantes durante um smoke live.
2. **Callback:** concluir/cancelar/expirar a navegação e confirmar que o callback não ativa plano.
3. **Webhook inválido:** token incorreto retorna `401` e não cria efeito persistente.
4. **Webhook duplicado:** reenviar o mesmo `providerEventId`; resposta continua sucesso e o efeito ocorre uma única vez.
5. **Checkout terminal:** expirar/cancelar e confirmar que a tentativa fica terminal e uma resposta tardia não a reconfirma.
6. **Pix Automático:** quando habilitado na conta sandbox, criar autorização, confirmar estado pendente e testar ao menos um encerramento cancelado/recusado/expirado sem concessão de acesso.
7. **Reconciliação:** provocar ou simular uma divergência recuperável, executar o comando administrativo e confirmar ausência de mutação duplicada.

### Evidência sanitizada

Registrar junto ao procedimento operacional, fora de segredos:

```text
sha=<commit>
environment=sandbox
executed_at=<timestamp>
operator=<responsável autorizado>
checkout_id=<id seguro>
pix_authorization_id=<id seguro ou n/a>
webhook_duplicate=passed|failed
terminal_event=passed|failed
reconciliation=passed|failed
result=passed|failed
notes=<sem PII, payload bruto ou segredo>
```

IDs do provider podem ser registrados quando necessários para correlação operacional, mas nomes, e-mails, CPF/CNPJ, telefone, QR payload e segredos não devem aparecer na evidência.

## Rollback e escalonamento

- Se a integração sandbox divergir do contrato versionado, não habilite produção.
- Se produção já estiver habilitada em rollout autorizado, interrompa novas contratações pelo mecanismo de catálogo/configuração aprovado; não apague assinaturas existentes nem altere banco manualmente.
- Preserve eventos e operações para reconciliação.
- Escale divergência não resolvida com `contractKey`, IDs seguros, SHA, horário e classe de erro, sem payload sensível.
- Mudança de segredo, provider, catálogo ou `BILLING_ACCESS_MODE` exige autorização operacional própria e não é consequência automática deste runbook.

## Referências

- `docs/design-docs/billing-asaas-adapter.md`
- `docs/design-docs/billing-subscription-lifecycle.md`
- `docs/product-specs/billing-commercial-decisions.md`
- documentação oficial de Checkout: `https://docs.asaas.com/docs/checkout-link-and-customer-redirection`
- referência de criação do Checkout: `https://docs.asaas.com/reference/create-new-checkout`
