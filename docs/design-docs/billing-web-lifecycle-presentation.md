# Apresentação de lifecycle em `/billing`

## Fonte de verdade

A tela `/billing` não calcula elegibilidade nem produz transições, grandfathering ou estados financeiros. Ela projeta somente contratos já persistidos pelo backend:

- `getUserEntitlements` para origem efetiva e janela de acesso;
- `billingSubscriptionLifecycle` para trial, carência, suspensão, recuperação e término;
- fatos de `billingSubscriptionFacts` para capacidade e sincronização da renovação individual sob cobertura;
- catálogo efetivo para preço, ciclo, capacidade e meios de pagamento.

`validFrom` e `validUntil` são devolvidos pelo access service para que a interface consiga apresentar a duração real de uma transição já escolhida pela precedência canônica. A UI não escolhe se uma transição deve durar 7 ou 30 dias.

## Transições

Quando a origem efetiva é `transition_access`, a interface mostra início e término do entitlement selecionado:

- janela de 7 dias: perda de cobertura profissional;
- janela de 30 dias: transição comercial de usuário existente;
- qualquer outra janela continua sendo descrita genericamente a partir das datas autoritativas, sem inventar regra.

Quando a origem é `read_only_access`, a tela explica que leitura, exportação e gestão permanecem disponíveis e que novos recursos pagos ficam bloqueados até existir nova origem válida.

## Regularização financeira

Em `past_due` e `suspended`, `billing.regularizeSubscription` não cria cobrança nem altera lifecycle. O backend:

1. valida `subscriptionId` + `payerUserId` antes de consultar o provider;
2. lista cobranças já geradas para a assinatura;
3. seleciona somente cobrança vencida, ou pendente já vencível, pertencente à assinatura;
4. aceita apenas `invoiceUrl` HTTPS em `asaas.com` ou subdomínio;
5. devolve a URL da fatura existente como fluxo pendente.

Navegar para a fatura nunca confirma pagamento. A recuperação do acesso continua dependendo de status/webhook autoritativo e da máquina de lifecycle da #893.

## Cobertura profissional e renovação individual

Quando a cobertura profissional é a origem principal, a tela consulta somente fatos e assinatura individual do próprio paciente. O estado de sincronização da renovação é apresentado como `requested`, `pending`, `confirmed` ou mantida. Se a renovação por cartão já estiver cancelada e o backend suportar reativação, o botão existente é apresentado como **Manter renovação individual**. Pix Automático não simula reativação: a necessidade de nova autorização é informada explicitamente.

A situação visível também considera `cancelAtPeriodEnd` autoritativo. Assim, depois de uma reativação confirmada, a mensagem deixa de instruir o usuário a manter algo que já está mantido.

## Capacidade profissional

`professionalCapacityRead` reutiliza `professionalCapacityWarningMilestones` da política da #894. A UI recebe:

- capacidade contratada, ocupação, excedente e limite temporário;
- horizonte atual `initial` (90 dias) ou `extension` (30 dias confirmados);
- data final;
- marcos canônicos início, D60, D30, D15, D7 e vencimento que pertencem ao horizonte atual;
- sinal persistido de análise administrativa/comercial quando a carteira ultrapassa a maior capacidade pública.

Extensões não são inferidas. Pacientes existentes e dados nunca são apresentados como sujeitos a remoção automática.

## Cupons

A UI traduz os motivos canônicos de inelegibilidade retornados pelo backend (inativo, validade, produto/versão/ciclo, limite total, limite por usuário, primeira contratação, moeda ou desconto inválido) para linguagem de usuário. O frontend não recalcula desconto nem converte uma rejeição em elegibilidade.
