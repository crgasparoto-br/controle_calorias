# Medição de consumo, economia e governança de uso

Este documento registra o contrato da issue #897. A camada é **gerencial e operacional**: não substitui conciliação contábil/fiscal nem autoriza cobrança por consumo. Preços técnicos continuam no catálogo versionado de IA e estado comercial continua no módulo de billing.

## Eventos de consumo

`billingUsageEvents` é o ledger detalhado idempotente. Cada evento congela, quando aplicável, beneficiário/paciente, patrocinador/pagador, assinatura, produto/versão/ciclo, fonte de acesso, operação, canal, provider/modelo, unidade, custo estimado/efetivo, moeda, resultado, retry, ambiente, competência, correlação e versão da regra.

O paciente permanece beneficiário quando o profissional paga. O custo é atribuído à assinatura/pagador profissional e o auto-uso do profissional usa a mesma assinatura, sem criar uma segunda fonte comercial. Trial, transição, acesso aberto e liberações administrativas permanecem fontes distintas. Como a atribuição comercial é congelada no evento, uma mudança posterior de plano ou patrocinador não reatribui o histórico já medido; eventos novos usam o contexto vigente no momento da execução.

Eventos de IA derivam do evento normalizado de observabilidade. Cada execução lógica recebe uma identidade opaca e cada tentativa primária, retry ou fallback recebe uma posição própria nessa execução. Antes da chamada ao provider, a posição é persistida e reivindicada como `provider_dispatch_started`; falha nessa etapa bloqueia a chamada. Se a finalização falhar depois da resposta, a posição iniciada permanece recuperável e o provider não é repetido. Prompt, resposta, texto de mensagem, áudio, imagem e transcrição não são copiados para o ledger.

O inventário de custos diretamente mensuráveis também cobre o overlay local de imagem (pixels processados), uploads e leituras do storage (bytes) e o download de mídia da Meta (bytes). Esses produtores usam atribuição da requisição autenticada ou do usuário resolvido no WhatsApp e armazenam somente classe de conteúdo, provider e unidades. URLs assinadas criadas sem transferir o objeto, leitura de configuração, CPU geral do monólito e tráfego sem identidade de beneficiário são não aplicáveis por não representarem custo direto atribuível com unidade observada; custos fixos de servidor continuam fora do KPI conforme o contrato.

Envios físicos pela WhatsApp Cloud API usam a própria posição idempotente do ledger como barreira durável **antes** da primeira chamada ao provider. O transporte cria `provider_dispatch_reserved` e faz um claim atômico para `provider_dispatch_started`; somente quem obteve o claim pode chamar a Meta. Um callback/reprocessamento que encontre `success` reutiliza o resultado lógico sem nova chamada, e um estado `provider_dispatch_started` impede repetir um efeito externo cujo resultado pode estar incerto. Se a reserva ou o claim não puderem ser persistidos, o envio falha fechado antes da Meta.

Cada tentativa física — original, retry ou fallback textual — possui chave durável própria sob uma raiz lógica estável. Assim, a falha original e o fallback ficam em linhas distintas e continuam mensuráveis sem que replay/callback duplicado repita nenhuma delas. Depois de cada tentativa, sua linha é finalizada como `success` ou `failure`. Se a finalização pós-provider ficar indisponível, `provider_dispatch_started` permanece no ledger como evidência durável da tentativa e como lacuna observável de qualidade; ela não desaparece nem autoriza uma chamada duplicada. O claim registra `providerDispatchStartedAt`; ao repetir o mesmo entrypoint depois do lease de cinco minutos, o estado pendente é encerrado como `provider_dispatch_uncertain`, ainda sem nova chamada ao provider, evitando ficar indefinidamente em processamento. A correlação deriva do inbound/lifecycle e da posição lógica da resposta. Esses eventos preservam paciente e patrocinador, usam `provider=meta`, `channel=whatsapp` e permanecem `unpriced` até a conciliação efetiva do provider; nenhum preço da Meta é inferido pelo produto.

## Reconciliação de custo

Custo estimado e custo efetivo são estados diferentes do mesmo evento. `billingUsageCostReconciliations` registra cada correção efetiva com chave idempotente, valor estimado anterior, valor efetivo anterior, novo valor efetivo, moeda, data, motivo, responsável, correlação e versão da regra. A reconciliação atualiza `effectiveCostMicros` sem apagar `estimatedCostMicros` e recompõe os agregados diário e mensal afetados. Reusar a mesma chave com outro evento, valor ou moeda é conflito; repetir exatamente a mesma reconciliação é no-op idempotente.

O antigo tipo administrativo `usage_cost_correction` não é aceito como fato econômico de receita/dedução: correção de custo variável deve passar pelo contrato de reconciliação para alterar o numerador do KPI de forma auditável.

## Economia gerencial

`billingEconomicFacts` registra fatos idempotentes e versionados como receita contratual, desconto, cupom, crédito, reembolso, chargeback, imposto sobre receita, tarifa efetiva de recebimento e custo financeiro. Uma estimativa pode ser supersedida uma única vez por um fato efetivo que referencia sua chave, preservando as duas linhas e retirando somente a estimativa supersedida do agregado. A transação valida tipo, pagador, assinatura, produto, versão, ciclo, moeda e competência. Retry com payload equivalente é no-op; reutilização conflitante da chave idempotente é rejeitada.

A receita gerencial é reconhecida proporcionalmente ao período de serviço, inclusive em planos anuais; pagamento antecipado não concentra receita no mês de caixa. O fim da competência é respeitado exatamente e a distribuição mensal conserva o valor total do fato mesmo quando a vigência começa ou termina no meio do mês. Trial, transição, acesso aberto e waiver não geram receita contratual reconhecida sem fato comercial correspondente.

Fatos econômicos retroativos recompõem imediatamente todos os meses de competência afetados. Quando o detalhe de consumo já saiu da retenção, a recomposição preserva o custo variável previamente consolidado no agregado mensal em vez de reconstruí-lo como zero; retries idempotentes do mesmo fato também repetem a recomposição para recuperar falhas ocorridas depois da persistência do ledger.

Receita econômica líquida:

`receita contratual reconhecida - descontos - cupons - créditos - reembolsos - chargebacks - impostos sobre receita - tarifas efetivas de recebimento`.

Custo de antecipação de recebíveis fica separado como custo financeiro e não entra no denominador do KPI. Moedas permanecem separadas: custo variável somente entra no KPI de um bucket econômico quando sua moeda coincide com a moeda da receita. Se existir custo em outra moeda e não houver regra de FX versionada, o KPI daquele bucket fica indisponível em vez de converter ou somar silenciosamente valores incompatíveis; o custo permanece visível em um bucket próprio de sua moeda mesmo quando não existe receita correspondente.

O KPI de custo variável é `custos variáveis diretos / receita econômica líquida`. A leitura mensal continua disponível. Para decisões comerciais, o backend calcula média móvel ponderada de três meses por pagador/assinatura/versão/moeda: até 20% saudável; acima de 20% até 25% atenção; acima de 25% revisão; acima de 30% por dois meses móveis consecutivos exige revisão administrativa. Uma janela com mês economicamente incomparável por moeda também fica indisponível. A faixa **nunca limita usuário automaticamente**.

## Fair use e abuso

O lançamento não cobra excedente, créditos ou pacotes. A política padrão prevê 90 dias de observação e alertas em 70/85/100% do orçamento esperado. `billingUsagePolicies` é o contrato persistente e versionado para configurar orçamento, moeda, janela de observação e os três thresholds crescentes por escopo global ou usuário; analytics usa a política específica ativa e recua para a global/padrão quando necessário. Trocar thresholds não habilita bloqueio automático e toda substituição preserva a versão anterior como revogada.

Alto custo isolado não é abuso e não abre um caso sozinho. A abertura normal exige uma combinação de sinais reconhecidos e distintos; sinal arbitrário é rejeitado. A única exceção de sinal único é uma condição de segurança reconhecida acompanhada de `securityRiskConfirmed=true`, porque esse mesmo nível de prova é exigido para a proteção emergencial limitada a 24 horas.

Limitação normal exige revisão humana com evidência sanitizada, exclusão de falhas/retries do sistema, revisão de crescimento legítimo e um conjunto **não vazio** de operações pesadas afetadas. Esse conjunto é persistido em `impactJson` e passa a ser o limite de autorização da etapa seguinte: a limitação somente pode selecionar um subconjunto das operações que a revisão humana aprovou para o mesmo caso. Uma operação diferente, mesmo que tecnicamente pesada, é rejeitada.

A primeira limitação é de até sete dias. Existe no máximo uma extensão normal adicional de até sete dias para o mesmo caso, iniciada exatamente no término da janela inicial e executada por um segundo administrador autenticado distinto; uma janela revogada não pode ser estendida. Proteção emergencial de segurança pode durar até 24 horas antes da revisão completa, exige sinal de segurança reconhecido e `securityRiskConfirmed=true` na evidência sanitizada, e não pode ser encadeada repetidamente no mesmo caso.

A admissão e a criação da janela ocorrem na mesma transação, com lock do caso e unicidade de `initial`, `extension` e `emergency` por caso. Revogação usa a mesma ordem de lock, fechando races entre criar/criar e revogar/estender. O usuário pode submeter um único recurso persistido por limitação; a revisão administrativa registra revisor, datas, racional e resultado. Aprovação revoga imediatamente a limitação e fecha o caso, enquanto negativa preserva o resultado e deixa o encerramento automático ocorrer no término da janela.

Limitações atingem somente operações pesadas explicitamente listadas e aprovadas; login, leitura, exportação e registros manuais não são retirados. O executor comum de IA consulta somente uma limitação administrativa ativa antes de chamar provider. Orçamento, KPI, plano ou feature flag não produzem bloqueio por conta própria.

`billingUsageAllowanceGrants` permite franquia adicional ou isenção temporária para usuário/profissional, com início, fim, motivo, responsável e revogação. Uma `temporary_exemption` ativa é consultada pelo gate de execução e prevalece sobre uma limitação administrativa durante a sua vigência; para paciente patrocinado, a isenção do profissional patrocinador também se aplica. Esses registros não criam cobrança, assinatura ou evento financeiro no Asaas.

## Cobrança futura por consumo

Medição e autorização de cobrança são contratos separados. `billingConsumptionChargeAuthorizations` exige responsável, motivo, política, preços, planos/versões afetados, data futura de vigência, comunicação anterior, proibição de retroatividade e plano de rollback não vazio. A revogação/desativação registra data, responsável e motivo, preservando a trilha de retorno da política. A janela de observação nunca pode ser convertida retroativamente em cobrança.

## Agregação e relatórios

`billingUsageDailyAggregates` mantém consumo por dia e dimensões comerciais, inclusive paciente, e `billingEconomicMonthlyAggregates` mantém competência, receita reconhecida, deduções, receita líquida, custo variável, KPI e qualidade da medição. A consulta usa páginas internas por chave sobre agregados, sem limite silencioso de linhas, e retorna `coverage` com fonte, intervalo disponível, retenção, estado completo/parcial e `truncated=false`. Assim consultas históricas não varrem indefinidamente o ledger detalhado e janelas além dos 24 meses de detalhe declaram explicitamente a cobertura parcial de uso, preservando a série econômica mensal de cinco anos.

O contrato administrativo `billing.adminUsageAnalytics` permanece separado da UI e retorna uso por beneficiário/paciente, patrocinador/pagador, produto, versão, ciclo, origem, operação, canal e provider/modelo. Para planos profissionais, também retorna custo total, custo médio por paciente ativo, percentis p50/p75/p90/p95 e distribuição das carteiras nas faixas 1–10, 11–25, 26–50 e 51+ pacientes. A economia mensal, a média móvel de três meses e a indicação explícita de revisão obrigatória quando a média permanece acima de 30% por dois meses consecutivos continuam separadas. Valores econômicos são gerenciais até homologação contábil/fiscal apropriada.

## Retenção e legal hold

Política `2026-08-16.5`:

- eventos detalhados de consumo: **13 meses**;
- agregados diários: **24 meses**;
- agregados financeiros/econômicos mensais: **5 anos**;
- trilhas de decisão, autorização e limitação: **5 anos**.

O ciclo automático registra `billingUsageRetentionAudit`. Antes do cutoff, ele materializa limitações expiradas e fecha casos dispensados ou cujo último horizonte terminou, sem encerrar caso com recurso pendente. O cutoff de cinco anos também é aplicado automaticamente a recursos resolvidos, políticas revogadas, concessões encerradas, casos fechados, limitações encerradas, autorizações de cobrança revogadas, reconciliações, execuções de retenção e legal holds encerrados. `billingUsageLegalHolds` suspende a eliminação aplicável enquanto o hold estiver ativo, respeitando início/fim e os escopos global, usuário/pagador/patrocinador e assinatura. Agregados preservados não contêm conteúdo conversacional bruto e não devem permitir reconstruí-lo.

## Privacidade

A correlação de conversa é SHA-256 truncada antes da persistência econômica. IDs usados na medição da Meta também são reduzidos a referências opacas antes de entrar no ledger; telefone e conteúdo da mensagem não são copiados. O sanitizador de observabilidade rejeita chaves associadas a prompt, conteúdo, texto, mensagem, transcrição, mídia, erro bruto, segredo, token e URL. A medição armazena somente metadados necessários a custo, atribuição, qualidade e auditoria.
