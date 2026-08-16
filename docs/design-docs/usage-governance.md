# Medição de consumo, economia e governança de uso

Este documento registra o contrato da issue #897. A camada é **gerencial e operacional**: não substitui conciliação contábil/fiscal nem autoriza cobrança por consumo. Preços técnicos continuam no catálogo versionado de IA e estado comercial continua no módulo de billing.

## Eventos de consumo

`billingUsageEvents` é o ledger detalhado idempotente. Cada evento congela, quando aplicável, beneficiário/paciente, patrocinador/pagador, assinatura, produto/versão/ciclo, fonte de acesso, operação, canal, provider/modelo, unidade, custo estimado/efetivo, moeda, resultado, retry, ambiente, competência, correlação e versão da regra.

O paciente permanece beneficiário quando o profissional paga. O custo é atribuído à assinatura/pagador profissional e o auto-uso do profissional usa a mesma assinatura, sem criar uma segunda fonte comercial. Trial, transição, acesso aberto e liberações administrativas permanecem fontes distintas.

Eventos de IA derivam do evento normalizado de observabilidade. A chave idempotente usa a referência opaca da mensagem/conversa quando disponível, evitando duplicação em callbacks/reprocessamentos; retries pagos continuam explicitamente identificados como tentativas adicionais. Prompt, resposta, texto de mensagem, áudio, imagem e transcrição não são copiados para o ledger.

## Economia gerencial

`billingEconomicFacts` registra fatos idempotentes e versionados como receita contratual, desconto, cupom, crédito, reembolso, chargeback, imposto sobre receita, tarifa efetiva de recebimento e custo financeiro. Valores estimados e efetivos não são misturados silenciosamente.

A receita gerencial é reconhecida proporcionalmente ao período de serviço, inclusive em planos anuais; pagamento antecipado não concentra receita no mês de caixa. Trial, transição, acesso aberto e waiver não geram receita contratual reconhecida sem fato comercial correspondente.

Receita econômica líquida:

`receita contratual reconhecida - descontos - cupons - créditos - reembolsos - chargebacks - impostos sobre receita - tarifas efetivas de recebimento`.

Custo de antecipação de recebíveis fica separado como custo financeiro e não entra no denominador do KPI. Moedas permanecem separadas; conversão futura exige regra de FX explicitamente versionada.

O KPI de custo variável é `custos variáveis diretos / receita econômica líquida`. Faixas mensais e para média móvel de três meses: até 20% saudável; acima de 20% até 25% atenção; acima de 25% revisão; acima de 30% por dois meses consecutivos exige revisão administrativa. A faixa **nunca limita usuário automaticamente**.

## Fair use e abuso

O lançamento não cobra excedente, créditos ou pacotes. A política prevê 90 dias de observação e alertas configuráveis em 70/85/100% do orçamento esperado. Atingir 100% apenas abre sinal operacional.

Alto custo isolado não é abuso. Sinais automáticos podem abrir caso, mas limitação normal exige revisão humana com evidência sanitizada, exclusão de falhas/retries do sistema, revisão de crescimento legítimo, operações afetadas, aprovação administrativa, comunicação e oferta de revisão/apelação. A primeira limitação é de até sete dias. Extensão, quando implementada, exige segundo responsável e mais no máximo sete dias. Proteção emergencial de segurança pode durar até 24 horas antes da revisão.

Limitações atingem somente operações pesadas explicitamente listadas; login, leitura, exportação e registros manuais não são retirados. O executor comum de IA consulta apenas uma limitação administrativa ativa antes de chamar provider. Orçamento, KPI, plano ou feature flag não produzem bloqueio por conta própria.

`billingUsageAllowanceGrants` permite franquia adicional ou isenção temporária para usuário/profissional, com início, fim, motivo, responsável e revogação. Esses registros não criam cobrança, assinatura ou evento financeiro no Asaas.

## Cobrança futura por consumo

Medição e autorização de cobrança são contratos separados. `billingConsumptionChargeAuthorizations` exige responsável, motivo, política, preços, planos/versões afetados, data futura de vigência, comunicação anterior, proibição de retroatividade e rollback. A janela de observação nunca pode ser convertida retroativamente em cobrança.

## Agregação e relatórios

`billingUsageDailyAggregates` mantém consumo por dia e dimensões comerciais. `billingEconomicMonthlyAggregates` mantém competência, receita reconhecida, deduções, receita líquida, custo variável, KPI e qualidade da medição. Assim consultas históricas não precisam varrer indefinidamente o ledger detalhado.

O contrato administrativo `billing.adminUsageAnalytics` permanece separado da UI e retorna uso operacional e economia mensal. Valores econômicos são gerenciais até homologação contábil/fiscal apropriada.

## Retenção e legal hold

Política `2026-08-16.2`:

- eventos detalhados de consumo: **13 meses**;
- agregados diários: **24 meses**;
- agregados financeiros/econômicos mensais: **5 anos**;
- trilhas de decisão, autorização e limitação: **5 anos**.

O ciclo automático registra `billingUsageRetentionAudit`. `billingUsageLegalHolds` suspende eliminação somente para escopo documentado enquanto estiver ativo. Agregados preservados não contêm conteúdo conversacional bruto e não devem permitir reconstruí-lo.

## Privacidade

A correlação de conversa é SHA-256 truncada antes da persistência econômica. O sanitizador de observabilidade rejeita chaves associadas a prompt, conteúdo, texto, mensagem, transcrição, mídia, erro bruto, segredo, token e URL. A medição armazena somente metadados necessários a custo, atribuição, qualidade e auditoria.
