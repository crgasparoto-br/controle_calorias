# Evidência de rollout comercial — template

> Copie este arquivo para um registro datado por janela/etapa. Não preencher com valores fictícios. Não registrar segredos, payloads financeiros brutos, PII ou dados clínicos.

## Identidade da execução

- issue: `#898`
- fase: `PENDENTE`
- ambiente: `PENDENTE`
- SHA implantado: `PENDENTE`
- início absoluto + timezone: `PENDENTE`
- fim absoluto + timezone: `PENDENTE`
- `cutoverId`/`snapshotKey`: `PENDENTE`
- `ruleVersion`: `PENDENTE`
- critério da coorte: `PENDENTE`
- população planejada agregada: `PENDENTE`
- população efetiva agregada: `PENDENTE`

## Mapeamento semântico dos pré-requisitos

Não usar apenas o estado aberto/fechado de números da faixa `#869–#897`. Registrar o vínculo funcional aplicável.

| Requisito de billing | Issue/PR/SHA correto | Evidência | Estado |
| --- | --- | --- | --- |
| catálogo | `PENDENTE` | `PENDENTE` | `hold` |
| checkout/provider | `PENDENTE` | `PENDENTE` | `hold` |
| webhook/fila/reconciliação | `PENDENTE` | `PENDENTE` | `hold` |
| lifecycle/suspensão/recuperação | `PENDENTE` | `PENDENTE` | `hold` |
| cobertura/capacidade profissional | `PENDENTE` | `PENDENTE` | `hold` |
| onboarding/elegibilidade | `PENDENTE` | `PENDENTE` | `hold` |
| medição/economia | `PENDENTE` | `PENDENTE` | `hold` |
| comunicação | `PENDENTE` | `PENDENTE` | `hold` |
| observabilidade/rollback | `PENDENTE` | `PENDENTE` | `hold` |

## Parâmetros e homologações

- corte absoluto aprovado: `PENDENTE`
- produto: `PENDENTE`
- técnico: `PENDENTE`
- billing: `PENDENTE`
- suporte: `PENDENTE`
- administrador autorizador: `PENDENTE`
- privacidade/jurídico: `PENDENTE`
- contador/fiscal: `PENDENTE`
- campanha/template/remetente homologados: `PENDENTE`

## Gates quantitativos e absolutos

| Gate | Valor observado | Critério | Resultado |
| --- | ---: | --- | --- |
| cobrança duplicada | `PENDENTE` | `0` | `hold` |
| ativação sem fato financeiro autoritativo | `PENDENTE` | `0` | `hold` |
| bloqueio indevido | `PENDENTE` | `0` | `hold` |
| perda de dados/vínculos/prontuários/capacidade | `PENDENTE` | `0` | `hold` |
| eventos financeiros persistidos antes do processamento | `PENDENTE` | `100%` | `hold` |
| processados em até 5 min | `PENDENTE` | `>=95%` | `hold` |
| reconciliáveis em até 30 min | `PENDENTE` | `100%` | `hold` |
| divergência financeira | `PENDENTE` | `<0,5%` | `hold` |
| divergências resolvidas em até 24h | `PENDENTE` | `100%` | `hold` |
| notificações internas essenciais persistidas | `PENDENTE` | `100%` | `hold` |
| falhas externas visíveis/reprocessáveis | `PENDENTE` | `sim` | `hold` |
| incidente crítico/alto aberto | `PENDENTE` | `0` | `hold` |
| falha conhecida de segurança/privacidade | `PENDENTE` | `0` | `hold` |
| rollback ensaiado | `PENDENTE` | `sim` | `hold` |
| métricas econômicas/consumo/qualidade/cobertura | `PENDENTE` | `disponíveis` | `hold` |

## Corte e transição

- snapshot idempotente conferido: `PENDENTE`
- usuários pré-corte mantêm início/fim estáveis em reexecução: `PENDENTE`
- transição gratuita de 30 dias conferida: `PENDENTE`
- ausência de cartão/cobrança automática no corte: `PENDENTE`
- ausência de cobrança retroativa: `PENDENTE`
- usuários pós-corte seguem elegibilidade normal: `PENDENTE`

## Profissionais e pacientes

- vínculos e prontuários preservados: `PENDENTE`
- carteira excedida preservada: `PENDENTE`
- novas aprovações/inclusões/reativações bloqueadas apenas quando aplicável: `PENDENTE`
- capacidade temporária de 90 dias conferida: `PENDENTE`
- extensões de 30 dias auditadas e não automáticas: `PENDENTE`
- pacientes não receberam detalhes financeiros do patrocinador: `PENDENTE`

## Comunicações

- notificação interna persistida antes do canal externo: `PENDENTE`
- campanha/versionamento: `PENDENTE`
- idempotência por usuário/tipo/marco/campanha: `PENDENTE`
- retries e obsolescência: `PENDENTE`
- falhas definitivas visíveis/reprocessáveis: `PENDENTE`
- e-mail: `PENDENTE`
- WhatsApp: `PENDENTE`

## Incidentes, reconciliação e suporte

- incidentes/tickets: `PENDENTE`
- divergências e causa: `PENDENTE`
- reconciliação executada: `PENDENTE`
- backlog residual: `PENDENTE`
- impacto conhecido: `PENDENTE`
- ação corretiva: `PENDENTE`

## Rollback/recovery drill

- alvo restaurado: `open_access`
- novas ativações interrompidas: `PENDENTE`
- comunicações/bloqueios pausados: `PENDENTE`
- fatos financeiros preservados: `PENDENTE`
- assinaturas/capacidade/auditoria preservadas: `PENDENTE`
- usuários afetados reconciliados: `PENDENTE`
- retorno validado: `PENDENTE`

## Decisão

- decisão: `hold`
- justificativa: `PENDENTE`
- evidências sanitizadas: `PENDENTE`
- responsável pela decisão: `PENDENTE`
- confirmação reforçada quando aplicável: `PENDENTE`
- próxima revisão: `PENDENTE`

A decisão só pode mudar para `advance` quando todos os gates aplicáveis estiverem comprovados. Qualquer incidente absoluto descrito na #898 mantém a etapa reprovada independentemente das taxas agregadas.
