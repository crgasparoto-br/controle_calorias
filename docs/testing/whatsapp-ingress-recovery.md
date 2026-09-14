# Recuperação de ingress do webhook do WhatsApp

Issue: #1061. Este runbook complementa o lifecycle persistente quando a falha acontece **antes** de `beginInboundMessage`/persistência/claim e define a correlação operacional necessária para distinguir retry real, restart e perda de ingress.

## Evidência de produção de 13/09/2026

O serviço Render `controle-calorias-api` permaneceu no mesmo commit publicado durante os restarts observados, sem novo deploy no intervalo. Foram observados restarts às 10:51:06, 10:57:33, 16:43:36 e 16:47:51 BRT. CPU e memória permaneceram abaixo dos limites observados; os logs acessíveis não mostram OOM ou saturação como causa comprovada.

Na ocorrência das 16:43 BRT, o runtime registrou `ingress_received` e `request_entering_lifecycle` às 16:43:13. Houve outro POST chegando ao mesmo runtime às 16:43:21, antes do restart das 16:43:36. Depois do novo boot, outro POST atingiu o runtime às 16:47:15, antes do segundo restart das 16:47:51. A telemetria existente naquele commit registrava apenas `bootId`, método e tamanho do payload; portanto não era possível provar se esses POSTs continham o mesmo `message.id` ou mensagens/callbacks distintos.

Após a PR #1078, a nova correlação permitiu provar uma ocorrência adicional: às `23:56:24.215Z` uma `QUESTION` chegou ao runtime e entrou no lifecycle com `messageCount=1` e fingerprint `1955aab92a9942eeae19`; não houve `WhatsAppReplyTransport` de ACK nem resposta final e a instância reiniciou às `23:56:37.608Z`. O runtime não registrou `termination_signal`, `process_exit` nem `uncaught_exception_monitor` antes do restart. CPU e memória continuavam abaixo dos limites. No intervalo verificado após o novo boot, não foi observado redelivery do mesmo fingerprint.

Essa ocorrência demonstra que o redelivery do provider continua importante, mas **não pode ser a única forma de recuperação** depois que o inbound já foi persistido. Uma `QUESTION` aceita e não concluída precisa ser retomável pelo próprio runtime seguinte quando o owner persistente ficar órfão.

Os logs disponíveis do Render registram `Instance ... restarted`, mas não expõem uma causa terminal específica. Não há, nas janelas consultadas, stack trace de crash da aplicação, OOM ou erro de startup que explique os restarts. A ausência de diagnóstico de término também impedia diferenciar um sinal enviado pela plataforma de uma exceção fatal do processo.

Há um amplificador controlável pela aplicação que já foi corrigido: `syncFoodCatalogReference()` deixou de bloquear `server.listen()`. Depois dessa mudança, os boots observados voltaram a `http_ready` em aproximadamente 9–10 s e o sync de catálogo passou a ocorrer depois da abertura HTTP.

## Contrato de disponibilidade pré-claim

1. Compatibilidade de schema continua sendo pré-condição de startup em produção.
2. Assim que a aplicação estiver apta a usar o schema, o servidor HTTP deve abrir a porta antes de tarefas de startup não críticas.
3. `syncFoodCatalogReference()` é tarefa não crítica: falha ou lentidão não deve manter o webhook indisponível.
4. Cada POST que alcance o processo recebe um `ingressId` aleatório apenas para correlacionar os logs daquele request.
5. `WhatsAppWebhook ingress_received` continua sendo emitido antes dos parsers/lifecycle e não contém telefone, texto, `message.id` ou payload bruto.
6. Depois do parse, `request_entering_lifecycle` repete o mesmo `ingressId` e adiciona `messageCount` mais `messageFingerprints`.
7. Cada `messageFingerprint` é um prefixo de SHA-256 derivado do `message.id`; ele é determinístico para permitir reconhecer redelivery da mesma mensagem, mas o identificador externo bruto nunca é gravado no log operacional.
8. Estados pós-claim continuam pertencendo ao lifecycle persistente: `inflight_retry`, `orphan_recovered` e `processed_duplicate` não são substituídos por cache local.
9. `request_not_reaching_runtime` continua sendo uma condição de borda: é inferida quando a plataforma registra 5xx/502 sem `ingress_received` correspondente.

Os eventos `Runtime boot_started` e `Runtime http_ready` compartilham um `bootId`. O runtime também registra diagnósticos de término que preservam a semântica padrão do Node:

- `Runtime uncaught_exception_monitor`: observação de exceção fatal pelo evento `uncaughtExceptionMonitor`, sem capturar/suprimir a exceção;
- `Runtime termination_signal`: observação de `SIGTERM`/`SIGINT`, seguida do reenvio imediato do mesmo sinal ao próprio processo;
- `Runtime process_exit`: saída observável pelo evento `exit`.

A ausência desses eventos antes de um `Instance ... restarted` não prova sozinha a causa do restart, mas elimina classes observáveis da aplicação e melhora a distinção entre crash JavaScript, término por sinal e interrupção que não chegou ao processo.

## Redelivery do provider

A documentação operacional do WhatsApp disponibilizada por provedores oficiais/BSPs descreve o webhook como entregue com sucesso somente quando recebe HTTP 200; falhas de entrega ou respostas não-200 entram em redelivery, normalmente com backoff. Essa propriedade é compatível com o contrato desta aplicação: 5xx pré/pós-claim não pode ser convertido em sucesso terminal, e retries podem repetir a mesma mensagem, exigindo idempotência persistente por `message.id`.

Essa referência documental **não substitui a prova do WABA desta aplicação**. Antes de encerrar a #1061, staging/controlado deve demonstrar redelivery real da Meta após indisponibilidade pré-runtime ou resposta 5xx e comprovar que o retry percorre o mesmo `POST /api/whatsapp/webhook`.

## Recovery interno de QUESTION pós-claim

Quando o inbound já existe na persistência, está sem `processedAt`, contém uma pergunta `/` e o owner anterior deixou de renovar seu heartbeat, o runtime pode retomá-lo sem esperar um novo POST da Meta.

O recovery é deliberadamente restrito:

- consulta somente inbounds textuais não concluídos cujo texto operacional sanitizado começa com `/`;
- considera apenas uma janela recente de 20 minutos, abaixo do TTL de 30 minutos da conversa persistente, para manter a mesma identidade de conversa/resposta;
- processa no máximo 10 candidatos por ciclo;
- executa ciclos a cada 15 segundos, sem sobreposição;
- chama o mesmo `beginInboundMessage` com o mesmo `externalMessageId` e adquire o mesmo claim persistente usado pelo webhook;
- owner com heartbeat ativo retorna `inflight` e não é roubado;
- owner órfão só é retomado depois da janela canônica de liveness do `messageLifecycle`;
- o roteamento continua em `resolveWhatsAppPrecedenceGate`, portanto ACK e IA usam os mesmos contratos da rota normal;
- ACK usa a identidade física estável `${message.id}:question-ack`; se já foi entregue, a governança de outbound não chama a Meta novamente;
- resposta final usa o mesmo lifecycle/identidade do inbound e é persistida como resposta funcional exatamente uma vez;
- se a resposta final já foi persistida mas `processedAt` ficou pendente, o recovery apenas conclui o lifecycle, sem nova IA nem novo outbound;
- falha de entrega não marca a mensagem como processada; o heartbeat cessa e uma nova tentativa só pode assumir depois da janela de liveness, evitando loop apertado.

Esse runner não cria fila externa, novo serviço ou endpoint paralelo. A persistência existente (`whatsappConversationMessages`, `whatsappMessageProcessingClaims` e governança de outbound) permanece como fonte única de verdade.

## Controle PRECLAIM-IDEM-001

1. Registrar o commit e `bootId` do runtime candidato.
2. Tornar o endpoint indisponível antes de qualquer execução de `handleWhatsAppPersistentContextWebhook`.
3. Entregar uma pergunta `/` real de staging e confirmar por telemetria que não houve `ingress_received`, inbound persistido ou claim na primeira tentativa.
4. Restaurar o runtime sem operação auxiliar de lifecycle, sem limpar cache/claim e sem gerar novo `message.id`.
5. Observar o redelivery do provider no mesmo endpoint público.
6. Confirmar que o retry traz o mesmo `messageFingerprint` no novo `ingressId` e percorre `request_entering_lifecycle` → claim/lifecycle canônico.
7. Confirmar no máximo um ACK efetivamente entregue e uma resposta final efetivamente entregue.
8. Repetir o mesmo `message.id` depois da conclusão e confirmar `processed_duplicate`, sem novo ACK/resposta/efeito.

O controle falha se a primeira tentativa tiver criado inbound/claim, se o retry depender de GET/health-check, se for necessário liberar claim manualmente, se um novo `message.id` for usado ou se a evidência vier apenas de um mock que chama `releaseMessageForRetry()`.

## Controle RESTART-CORR-001

Este controle cobre a ocorrência pós-ingress observada às 16:43 BRT e a reprodução das 23:56Z:

1. registrar `ingress_received` e `request_entering_lifecycle` para uma pergunta real;
2. capturar `bootId`, `ingressId` e `messageFingerprint` sem conteúdo/telefone/ID bruto;
3. terminar o runtime durante o processamento;
4. após novo `http_ready`, comprovar por `messageFingerprint` se a Meta redeliverou a mesma mensagem;
5. se houver redelivery, correlacionar o retry com `inflight_retry`, `orphan_recovered` ou `processed_duplicate` e a entrega funcional;
6. independentemente do redelivery, comprovar que uma `QUESTION` persistida e órfã é retomada pelo recovery interno após a janela de liveness;
7. confirmar no máximo um ACK lógico e uma resposta final lógica, inclusive quando ACK ou final já estavam persistidos antes do crash.

## Regressão automatizada

- `server/_core/runtimeAvailability.test.ts` prova que tarefas de startup não críticas não começam antes da disponibilidade HTTP e que falhas dessas tarefas não derrubam o bootstrap.
- `server/_core/runtimeTerminationDiagnostics.test.ts` prova que os diagnósticos não convertem exceção fatal em handler de recuperação e que `SIGTERM` é reenviado ao processo.
- `server/modules/whatsapp/webhookCorrelation.test.ts` prova fingerprint determinístico, ausência de `message.id`/telefone bruto e distinção de payload sem mensagens.
- `server/modules/whatsapp/questionRecovery.test.ts` cobre recovery sem novo POST, fence de owner ativo, conclusão sem duplicar resposta já persistida e entrega final pendente.
- `server/whatsappPersistentContextWebhook.restartOwnership.tidb.test.ts` contém o gate persistente que mata o fluxo após o claim e prova tanto redelivery do mesmo POST quanto retomada sem redelivery, sobre a mesma persistência.
- As demais regressões pós-claim permanecem em `server/whatsappPersistentContextWebhook.test.ts`, `server/whatsappImageIdempotencyWebhook.processingOwnership.test.ts` e testes do `messageLifecycle`.

## Gate de fechamento

A #1061 não deve ser encerrada apenas com correções de código ou com telemetria adicional. Além dos gates automatizados, é obrigatório anexar evidência controlada de:

- `PRECLAIM-IDEM-001`: indisponibilidade antes da persistência depende do redelivery real do WABA;
- `RESTART-CORR-001` com redelivery: o mesmo `message.id` converge idempotentemente;
- `RESTART-CORR-001` sem redelivery imediato: depois que o inbound já está persistido, o recovery interno retoma a `QUESTION` órfã e entrega no máximo um ACK lógico e uma resposta final lógica.

A issue só deve ser encerrada depois que esses três comportamentos forem observados no ambiente candidato.
