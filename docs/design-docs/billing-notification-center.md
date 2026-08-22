# Central de notificações de billing

## Objetivo

A rota autenticada `/billing` é a fonte permanente para comunicações comerciais, financeiras e de capacidade da própria conta. E-mail e WhatsApp são canais auxiliares; falha, ausência ou atraso desses canais não remove nem invalida a comunicação interna.

A implementação atende o complemento vinculante da issue #895 sem criar uma segunda máquina comercial. O conteúdo interno deriva de `billingSubscriptionFacts`, que já é a trilha autoritativa e idempotente do lifecycle e da capacidade profissional.

## Fonte interna e ordem de persistência

Um aviso existe internamente porque o fato autoritativo correspondente já foi persistido. A camada `billingNotificationCenter` somente projeta fatos permitidos para linguagem de usuário. Estado auxiliar de leitura/entrega usa um evento local idempotente `billing-web/notification_receipt` em `billingProviderEvents`, tabela já existente e também usada por operações web locais do billing; nenhum conteúdo financeiro novo é duplicado nesse receipt.

Quando houver tentativa externa, `deliverBillingNotificationExternally`:

1. valida ownership do fato pelo usuário alvo;
2. confirma que o fato possui apresentação pública permitida;
3. grava `pending` no receipt local;
4. somente então chama o canal externo;
5. registra `delivered` ou `failed` sem apagar o fato interno.

Não existe caminho em que falha externa remova o aviso do `/billing`.

## Estados independentes

A central mantém três dimensões separadas:

- **leitura**: `unread`/`read`, persistida no receipt local;
- **entrega externa**: `not_attempted`, `pending`, `delivered` ou `failed`, com canal e instante da última tentativa;
- **conclusão comercial**: `open` ou `completed`, derivada exclusivamente do estado/fato autoritativo do backend.

`billing.markNotificationRead` altera somente o campo de leitura do receipt. Ler uma mensagem nunca cancela, paga, regulariza, reativa, conclui análise nem encerra grandfathering.

## Conteúdo público

Cada item expõe somente linguagem sanitizada:

- campanha e versão de apresentação;
- título e situação;
- data efetiva;
- o que aconteceu;
- ação esperada, quando aplicável;
- consequência de nenhuma ação;
- orientação de suporte;
- link autenticado fixo para `/billing` quando existe ação na própria tela.

IDs de provider, IDs de assinatura, chaves de idempotência, nomes de enums internos e payload bruto não são exibidos. O `notificationId` é um identificador opaco usado apenas pela mutation autenticada de leitura.

## Privacidade de cobertura profissional

A consulta seleciona somente fatos cujo `payerUserId` é o usuário autenticado. Portanto um paciente coberto não recebe preço, inadimplência, método de pagamento, contrato ou capacidade do profissional patrocinador.

Se o paciente também possuir uma assinatura individual própria, os fatos dessa assinatura continuam sendo dele e podem ser exibidos normalmente. A origem patrocinada não amplia o escopo da consulta.

## Capacidade profissional

A UI não recalcula avisos. Ela consome os fatos canônicos produzidos pela #894:

- `professional_capacity_grandfathered_started`;
- `professional_capacity_warning` para início, D60, D30, D15, D7 e vencimento;
- `professional_capacity_extension_granted`;
- `professional_capacity_grandfathered_expired`;
- `professional_capacity_admin_alert_opened`;
- `professional_capacity_grandfathered_resolved`.

Quando a ocupação supera a maior capacidade pública ativa, o payload autoritativo do alerta permite comunicar que o caso foi encaminhado para análise administrativa/comercial, sem prometer criação automática de produto, preço ou plano.

## Renovação individual durante cobertura

Fatos `professional_coverage_individual_renewal_*` são apresentados ao próprio titular individual. A mensagem informa que a renovação está sendo sincronizada/cancelada e orienta o usuário a usar a ação explícita de reativação da sua própria assinatura quando o provider permitir. A central não reativa cobrança ao marcar leitura.

## Interface e degradação

`BillingNotificationCenter` fica no fluxo principal de `/billing`, antes dos detalhes de assinatura e do histórico técnico sanitizado. O componente possui:

- loading anunciado por `role=status`;
- erro isolado com retry e sem efeitos comerciais;
- estado vazio;
- artigos com título acessível;
- badges distintos para leitura e conclusão;
- layout responsivo;
- aviso genérico de falha do canal externo, sem detalhes técnicos;
- ação de marcar como lido com nome acessível contextual.

## Persistência auxiliar

Não há migration nova para a central. O conteúdo permanente continua em `billingSubscriptionFacts`; `billingProviderEvents` guarda somente o pequeno receipt local de leitura e tentativa de canal externo, identificado de forma idempotente por usuário + fato. Essa decisão evita uma segunda fonte de verdade e não altera o schema do banco.
