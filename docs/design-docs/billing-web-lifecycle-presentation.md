# Apresentação de lifecycle em `/billing`

## Fonte de verdade

A tela `/billing` não calcula elegibilidade nem produz transições, grandfathering ou estados financeiros. Ela projeta somente contratos já persistidos pelo backend:

- `getUserEntitlements` para origem efetiva e janela de acesso;
- `billingSubscriptionLifecycle` para trial, carência, suspensão, recuperação e término;
- fatos de `billingSubscriptionFacts` para capacidade e sincronização da renovação individual sob cobertura;
- catálogo efetivo para preço, ciclo, versão, capacidade e meios de pagamento;
- `trialEligibility` de `webOverview` para inelegibilidade de trial que já pode ser provada pelo histórico autoritativo local.

`validFrom` e `validUntil` são devolvidos pelo access service para que a interface consiga apresentar a duração real de uma transição já escolhida pela precedência canônica. A UI não escolhe se uma transição deve durar 7 ou 30 dias.

O resumo da assinatura usa o número comercial `billingPlans.version`, carregado junto da assinatura. `versionCode` permanece identificador interno e não é usado como rótulo de versão na interface.

## Transições

Quando a origem efetiva é `transition_access`, a interface mostra início e término do entitlement selecionado:

- janela de 7 dias: perda de cobertura profissional;
- janela de 30 dias: transição comercial de usuário existente;
- qualquer outra janela continua sendo descrita genericamente a partir das datas autoritativas, sem inventar regra.

Quando a origem é `read_only_access`, a tela explica que leitura, exportação e gestão permanecem disponíveis e que novos recursos pagos ficam bloqueados até existir nova origem válida.

## Trial e termos antes do checkout

Antes de abrir o checkout por cartão, a tela apresenta nome do plano, versão comercial, ciclo e preço retornados pelo catálogo. O backend também devolve a elegibilidade de trial que já pode ser determinada sem confiar em dados digitados no checkout:

- histórico de trial permitido para a mesma conta e audiência torna um novo trial indisponível;
- histórico de transição comercial torna um novo trial indisponível;
- quando a inelegibilidade é conhecida, `/billing` não oferece a opção de trial, mas continua permitindo contratação paga por cartão quando o catálogo permitir;
- telefone, CPF/CNPJ e cartão não são usados pelo frontend para decidir elegibilidade. A validação final de identidade continua no adapter do Asaas, com os dados verificados pelo provider.

Quando o trial está disponível e selecionado, a tela também informa:

- 7 dias para Individual ou 14 dias para Profissional;
- capacidade inicial de 5 pacientes no trial Profissional;
- data **estimada** da primeira cobrança se cadastro do cartão e trial iniciarem no dia atual;
- que a data efetiva será confirmada pelo backend/provider;
- que o usuário pode cancelar a próxima renovação durante o trial antes da primeira cobrança sem cobrança do plano;
- que eventual cupom começa na primeira cobrança efetiva.

A estimativa exibida antes do checkout não substitui `firstChargeAt` persistido depois da criação do trial. Quando existe lifecycle real, `/billing` mostra a data autoritativa retornada pelo backend.

## Renovação

Quando a assinatura não está marcada para encerrar no fim do período, `currentPeriodEnd` é apresentado como **Próxima renovação**. Quando `cancelAtPeriodEnd` está ativo, a mesma data é apresentada como **Fim do período atual**, junto da informação de que a renovação está desativada. A UI não recalcula nem desloca essa data.

## Regularização financeira

Em `past_due` e `suspended`, `billing.regularizeSubscription` não cria cobrança nem altera lifecycle. O backend:

1. valida `subscriptionId` + `payerUserId` antes de consultar o provider;
2. lista cobranças já geradas para a assinatura;
3. seleciona somente cobrança vencida, ou pendente já vencível, pertencente à assinatura;
4. aceita apenas `invoiceUrl` HTTPS em `asaas.com` ou subdomínio;
5. devolve a URL da fatura existente como fluxo pendente.

Navegar para a fatura nunca confirma pagamento. A recuperação do acesso continua dependendo de status/webhook autoritativo e da máquina de lifecycle da #893.

## Cobertura profissional e renovação individual

Quando a cobertura profissional é a origem principal, a tela consulta somente fatos e assinatura individual do próprio paciente. O estado de sincronização da renovação é apresentado como `requested`, `pending`, `confirmed` ou mantida. A leitura é vinculada à `coverageKey` cuja alocação ainda está ativa para aquele paciente, impedindo que uma cobertura antiga reapareça sob um patrocinador posterior.

Se a renovação por cartão já estiver cancelada e o backend suportar reativação, o botão existente é apresentado como **Manter renovação individual**. Pix Automático não simula reativação: a necessidade de nova autorização é informada explicitamente.

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
