# Cobertura profissional, capacidade e transições

## Escopo

Este documento registra o contrato técnico da issue #894. A máquina financeira continua pertencendo à #893: `pending`, `active`, `past_due`, `suspended` e `expired` são fatos comerciais de entrada. A #894 aplica esses fatos à cobertura do paciente, à reserva de capacidade e às transições de acesso, sem duplicar lógica de provider.

## Invariantes de cobertura

Uma cobertura profissional só é elegível quando existem simultaneamente:

- autorização profissional `approved`;
- acompanhamento `active` ou `paused`;
- reserva de capacidade `reserved` ou `active`;
- entitlement `professional_coverage` ativo;
- origem comercial profissional válida: `active`, trial `pending` vigente ou `past_due` dentro da tolerância.

`paused` mantém a vaga. `ended` e revogação clínica liberam a reserva de forma idempotente. `suspended` interrompe a cobertura patrocinada, mas mantém reserva e vínculo para que a recuperação reutilize a mesma alocação. `expired` encerra a origem comercial e libera explicitamente as reservas ainda ativas, preservando os registros históricos.

A seleção de acesso patrocinado é feita pelo lifecycle canônico. Em registros que já possuem `billingSubscriptionLifecycle`, o horizonte comercial da cobertura vem exclusivamente do lifecycle (`trialEndsAt`, `currentPeriodEnd` ou `graceEndsAt`); um `billingEntitlements.validUntil` antigo não pode encurtar `past_due` nem impedir a restauração. O candidato legado baseado somente em `billingSubscriptions.status` permanece restrito a assinaturas que ainda não possuem linha de lifecycle.

## Capacidade

Os limites comerciais continuam vindo do catálogo versionado:

- Profissional: 30 pacientes;
- Profissional Plus: 100 pacientes;
- trial profissional: 5 pacientes.

A reserva concorrente da fundação permanece a autoridade de admissão. Ela serializa o último slot e nunca usa a capacidade temporária de grandfathering para permitir crescimento. Se a ocupação existente exceder o limite contratado, todos os pacientes atuais são preservados, mas novas aprovações ficam bloqueadas até a ocupação voltar ao limite ou o contrato mudar.

## Grandfathering e alertas

O estado de capacidade é derivado de fatos append-only em `billingSubscriptionFacts`:

- `within_capacity`;
- `grandfathered_active`;
- `grandfathered_expiring` nos 15 dias finais;
- `grandfathered_expired` no limite temporal;
- `grandfathered_resolved` quando a ocupação natural volta ao limite contratado.

Ao primeiro cruzamento acima do limite, o reconciliador registra um fato `professional_capacity_grandfathered_started` com plano/versão, limite contratado, ocupação inicial, limite temporário fixado à ocupação inicial, início, fim em 90 dias, motivo e origem. Quando o cruzamento é detectado a partir de `contract_confirmed`, `startedAt` usa o `effectiveAt`/`occurredAt` do fato comercial e não o relógio do worker. A reconciliação que materializa essa janela ocorre antes do receipt `professional_coverage_fact_applied`; enquanto `contract_confirmed` permanecer pendente, a passagem genérica de capacidade não pode reconciliar a mesma assinatura com o relógio do worker. Assim, uma falha antes da reconciliação mantém o fato disponível para retry com o mesmo instante, e uma falha depois da reconciliação mas antes do receipt apenas repete idempotentemente a mesma janela. Backlog, restart ou retry não prolongam silenciosamente os 90 dias. O limite temporário preserva a carteira; ele nunca aumenta silenciosamente nem libera novas admissões.

Os avisos são fatos idempotentes nos marcos início, D-60, D-30, D-15, D-7 e expiração. Cada payload contém limite contratado, ocupação, excesso, data final, bloqueio de novas coberturas e alternativas (`natural_endings`, `upgrade`, `admin_extension`).

O primeiro cruzamento também gera `professional_capacity_admin_alert_opened`. Se a ocupação exceder a maior capacidade de plano profissional público ativo, o alerta usa `catalog_range_review_required` e prioridade `high`; nenhum plano é criado, publicado ou precificado automaticamente.

Prorrogações são ações administrativas auditadas e finitas. Cada concessão registra ator, motivo, estado da análise, limite temporário, início e fim de exatamente 30 dias. Não existe extensão automática ou retroativa.

## Transição após perda de cobertura

A perda efetiva de cobertura pode ocorrer por revogação clínica, encerramento de acompanhamento ou encerramento da origem comercial. O grant é serializado pelo usuário e consulta o histórico de `billingEntitlements` para garantir no máximo uma transição de 7 dias em uma janela móvel de 12 meses, independentemente da causa.

Se outra cobertura profissional válida continuar ativa, nenhuma transição é criada. Quando elegível, são persistidas duas origens explícitas:

1. `transition`, válida por 7 dias e herdando a matriz pessoal da cobertura encerrada;
2. `read_only`, com início exatamente no fim da transição, preservando login, leitura, exportação e gestão da conta sem reabrir escrita, WhatsApp, IA, imagens ou áudio.

Revogação e `ended` são persistidos pelo domínio clínico antes da reparação comercial. O processador da #894 deriva candidatos pendentes diretamente desse estado clínico persistido enquanto a alocação ou o entitlement patrocinado ainda estiverem ativos. A reparação resolve primeiro a decisão idempotente de transição e somente depois libera a alocação; uma falha transitória deixa o candidato detectável para retry posterior, sem desfazer a revogação clínica e sem perder permanentemente a transição do paciente.

Nenhum fluxo apaga refeições, metas, vínculos, autorizações, acompanhamentos ou histórico de alocação.

## Coexistência com assinatura individual

Cobertura profissional tem precedência sobre assinatura própria, mas a origem individual não é apagada. Depois da confirmação da cobertura, o serviço registra a intenção de cancelar a próxima renovação individual e realiza no máximo uma tentativa explícita pelo runtime oficial do provider.

- sucesso remoto: registra `professional_coverage_individual_renewal_confirmed`;
- falha, provider não configurado ou resultado incerto: registra `professional_coverage_individual_renewal_pending`;
- a cobertura profissional permanece válida em ambos os casos;
- nunca se apresenta cancelamento como concluído enquanto a sincronização estiver pendente;
- uma decisão explícita do usuário de manter a renovação é registrada como `kept_by_user`.

O período individual já pago continua registrado e não há reembolso proporcional automático.

## Consumo dos fatos da #893

O processador da #894 consome de forma idempotente os fatos profissionais relevantes da #893 e registra um receipt `professional_coverage_fact_applied` por `fact.id`.

- `coverage_pause_requested`: preserva reservas; a consulta de entitlement já remove acesso durante `suspended`;
- `coverage_restore_requested` / `subscription_recovered`: reutiliza as reservas existentes e reconcilia capacidade;
- `contract_confirmed`: reconcilia capacidade usando o instante efetivo do fato antes de registrar o receipt; se houver falha parcial, o retry reutiliza o mesmo `occurredAt` e a passagem genérica não pode substituir esse instante pelo relógio do worker;
- `subscription_expired`, `cancellation_effective` e `administrative_termination`: liberam reservas ainda ativas e avaliam a transição individual de cada paciente.

Além dos fatos comerciais, o mesmo processamento reconcilia perdas clínicas persistidas que ficaram parciais por indisponibilidade de billing. Eventos duplicados ou causas simultâneas não recriam reservas, não duplicam transições e não repetem warnings/alertas com a mesma chave de idempotência.

## Validação

Os testes unitários cobrem limites temporais, cooldown de 12 meses, marcos de aviso, estado de grandfathering, bloqueio de crescimento, escalonamento `catalog_range_review_required`, horizonte canônico de `past_due`, retry de perda clínica e ancoragem temporal em `contract_confirmed`. O controle temporal inclui falha antes do efeito, falha do receipt após o efeito e retry após restart, comprovando que nenhum desses caminhos troca `occurredAt` pelo relógio do worker. O serviço também cobre o contrato de uma tentativa de cancelamento individual e o estado `pending` em falha remota.

A validação integrada permanece nos gates normais de billing (`pnpm check`, `pnpm test`, `pnpm architecture:check`, `pnpm docs:check`, `pnpm build` e `pnpm agent:check`). Em ambiente com banco, os cenários concorrentes e de persistência devem continuar sendo exercitados pelo gate TiDB de billing.
