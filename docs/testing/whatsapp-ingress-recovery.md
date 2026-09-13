# Recuperação de ingress do webhook do WhatsApp

Issue: #1061. Este runbook complementa o lifecycle persistente quando a falha acontece **antes** de `beginInboundMessage`/persistência/claim.

## Evidência de produção de 13/09/2026

O serviço Render `controle-calorias-api` estava no commit `a784cb8a00165a2be04fd735aeda9e9413fef8d5`, sem novo deploy no intervalo. Foram observados restarts da instância às 10:51:06 e 10:57:33 BRT, com respostas 502 na mesma janela. CPU permaneceu baixa fora dos picos de startup e memória ficou aproximadamente entre 232 e 265 MB; não há evidência de OOM ou saturação.

Os logs disponíveis do Render registram o evento `Instance ... restarted`, mas não expõem uma causa terminal mais específica. Não há stack trace de crash da aplicação, `SIGTERM`, `exit`, `kill`, OOM ou health-check failure nos logs acessíveis. Portanto, a causa raiz do restart não deve ser atribuída à aplicação sem evidência adicional.

Há, porém, um amplificador controlável pela aplicação: antes desta correção, `syncFoodCatalogReference()` era aguardado antes de `server.listen()`. Na reprodução observada, o sync consumiu cerca de 15 s entre o início do processo e a abertura da porta HTTP. Como a sincronização já era best-effort e não é pré-condição para a integridade do lifecycle do WhatsApp, ela passou a executar somente **depois** de a disponibilidade HTTP estar confirmada e sem bloquear o servidor.

## Contrato de disponibilidade pré-claim

1. Compatibilidade de schema continua sendo pré-condição de startup em produção.
2. Assim que a aplicação estiver apta a usar o schema, o servidor HTTP deve abrir a porta antes de tarefas de startup não críticas.
3. `syncFoodCatalogReference()` é tarefa não crítica: falha ou lentidão não deve manter o webhook indisponível.
4. Um POST que alcance o processo registra `WhatsAppWebhook ingress_received` antes dos parsers/lifecycle, sem conteúdo da mensagem.
5. O dispatch para o lifecycle registra `request_entering_lifecycle`.
6. Estados pós-claim continuam pertencendo ao lifecycle persistente: `inflight_retry`, `orphan_recovered` e `processed_duplicate` não são substituídos por cache local.
7. `request_not_reaching_runtime` é uma condição de borda, não um evento que o próprio processo consiga emitir. Ela é inferida operacionalmente quando o proxy/plataforma registra 5xx/502 para o webhook e não existe `ingress_received` correspondente durante a janela do boot.

Os eventos `Runtime boot_started` e `Runtime http_ready` compartilham um `bootId`. Isso permite correlacionar restart, tempo até disponibilidade e requests que efetivamente alcançaram a aplicação sem registrar telefone, texto, `message.id` ou payload bruto.

## Redelivery do provider

A documentação operacional do WhatsApp disponibilizada por provedores oficiais/BSPs descreve o webhook como entregue com sucesso somente quando recebe HTTP 200; falhas de entrega ou respostas não-200 entram em redelivery, normalmente com backoff por até 7 dias. Essa propriedade é compatível com o contrato desta aplicação: 5xx pré/pós-claim não pode ser convertido em sucesso terminal, e retries podem repetir a mesma mensagem, exigindo idempotência persistente por `message.id`.

Essa referência documental **não substitui a prova do WABA desta aplicação**. Antes de encerrar a #1061, staging/controlado deve demonstrar redelivery real da Meta após indisponibilidade pré-runtime ou resposta 5xx e comprovar que o retry percorre o mesmo `POST /api/whatsapp/webhook`.

## Controle PRECLAIM-IDEM-001

1. Registrar o commit e `bootId` do runtime candidato.
2. Tornar o endpoint indisponível antes de qualquer execução de `handleWhatsAppPersistentContextWebhook`.
3. Entregar uma pergunta `/` real de staging e confirmar por telemetria que não houve `ingress_received`, inbound persistido ou claim na primeira tentativa.
4. Restaurar o runtime sem operação auxiliar de lifecycle, sem limpar cache/claim e sem gerar novo `message.id`.
5. Observar o redelivery do provider no mesmo endpoint público.
6. Confirmar `ingress_received` → `request_entering_lifecycle` → claim/lifecycle canônico.
7. Confirmar no máximo um ACK efetivamente entregue e uma resposta final efetivamente entregue.
8. Repetir o mesmo `message.id` depois da conclusão e confirmar `processed_duplicate`, sem novo ACK/resposta/efeito.

O controle falha se a primeira tentativa tiver criado inbound/claim, se o retry depender de GET/health-check, se for necessário liberar claim manualmente, se um novo `message.id` for usado ou se a evidência vier apenas de um mock que chama `releaseMessageForRetry()`.

## Regressão automatizada

`server/_core/runtimeAvailability.test.ts` prova que tarefas de startup não críticas não começam antes de a disponibilidade HTTP ser confirmada e que uma falha dessas tarefas não derruba o bootstrap já disponível.

As regressões pós-claim permanecem em `server/whatsappPersistentContextWebhook.restartOwnership.tidb.test.ts`, `server/whatsappPersistentContextWebhook.test.ts` e testes do `messageLifecycle`.

## Gate de fechamento

A #1061 não deve ser encerrada apenas com a correção de código. Além dos gates automatizados, é obrigatório anexar evidência do `PRECLAIM-IDEM-001` em staging/ambiente controlado. Se a Meta/WABA configurada não redeliver de forma suficiente para a janela de indisponibilidade, deve ser adotada uma estratégia suportada de disponibilidade/ingestão durável antes do fechamento da issue.
