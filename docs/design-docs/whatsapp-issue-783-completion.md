# Conclusão técnica da issue #783

Este documento registra o contrato final da issue #783. A seção equivalente em `docs/design-docs/whatsapp-ingestion.md` deve permanecer coerente com estas regras.

## Contrato final

Todos os caminhos alcançáveis pelo webhook e pelo simulador reutilizam os builders centrais de refeição e os mesmos mecanismos de seleção/confirmação persistida.

- Itens `heuristic` e `hybrid` exibem individualmente `⚠️ Valores nutricionais estimados pela IA.`. Itens `catalog` não exibem o aviso.
- Candidatos ambíguos preservam `mealId`, rótulo da refeição, índice e nome do item.
- Dois itens iguais ou semelhantes dentro da mesma refeição permanecem candidatos distintos; o primeiro não é escolhido silenciosamente.
- Ambiguidades entre refeições diferentes usam a mesma lista interativa da #782.
- Mensagens com ações claras e ambíguas são atômicas em relação à seleção: nenhuma chamada de atualização é feita antes de todas as escolhas.
- Quando existem várias ambiguidades, inclusive vários ajustes de gramas na mesma mensagem, as pendências são encadeadas em `remainingSelections`. Cada escolha é acumulada na ordem original e a escrita só ocorre após a última seleção.
- Cada ação de substituição ou ajuste mantém o respectivo alimento de destino, delta ou quantidade durante todo o encadeamento.
- Antes de escrever, todos os alvos são recarregados e revalidados contra o estado atual. A identidade validada permanece estável durante o plano, mesmo se uma ação anterior renomear o item. Mudanças concorrentes tornam o plano obsoleto e bloqueiam todas as alterações.
- Operações que alteram mais de uma refeição usam `mealBatchMutation.ts`. As tentativas não incrementam uso de catálogo, não acumulam hábitos e não emitem sucesso por refeição. Se qualquer atualização falhar, todas as refeições tentadas são restauradas em ordem inversa.
- Hábitos são reconstruídos de forma idempotente somente no sucesso integral ou ao final da compensação. Quando a restauração não puder ser confirmada, a resposta orienta a consultar o estado atual.
- Respostas finais usam `logicalReplyDelivery.ts` para compor texto, CTA de edição rápida e imagem auxiliar na mesma `WhatsAppLogicalReply`.
- Callbacks preservam `mealId` até o webhook, mantendo o CTA quando a refeição ainda existe.
- Depois da execução bem-sucedida, cada refeição afetada é renderizada integralmente, com itens e totais atuais.
- `recordAdjustmentIntent.ts`, `gramsAdjustmentIntent.ts` e `gramsIncrementIntent.ts` delegam aos mesmos handlers canônicos. Exclusões continuam exigindo confirmação.
- Os módulos que criam ou consomem pendências declaram `usesPendingOperation: true` e `requiresFreshDbQuery: true`.

## Principais módulos

- `server/modules/whatsapp/mealItemSelectionCallback.ts`: persistência, encadeamento, revalidação e aplicação do plano.
- `server/modules/whatsapp/mealBatchMutation.ts`: aplicação multirrefeição com compensação e comunicação segura em caso de falha.
- `server/modules/whatsapp/intent/mealTargetResolution.ts`: identidade de refeição por candidato.
- `server/modules/whatsapp/intent/gramsAdjustmentHandlers.ts`: ajustes absolutos, incrementos, reduções, correções de quantidade e encadeamento de todas as ambiguidades.
- `server/modules/whatsapp/intent/foodReplacementHandlers.ts`: substituições estruturadas.
- `server/modules/whatsapp/contextualFoodReplacementIntent.ts`: substituições contextuais recentes.
- `server/modules/whatsapp/logicalReplyDelivery.ts`: composição e envio único de texto, CTA e mídia auxiliar.
- `server/modules/whatsapp/recordAdjustmentIntent.ts`: compatibilidade do simulador/handler legado.

## Regressões cobertas

- Origem nutricional `catalog`, `heuristic`, `hybrid`, refeição mista e vários itens estimados.
- Ambiguidade dentro da mesma refeição e entre refeições.
- Ação clara junto de ação ambígua sem mutação parcial.
- Duas ou mais ambiguidades de gramas na mesma mensagem, preservadas em sequência.
- Várias substituições ambíguas com destinos diferentes.
- Atualização de várias refeições com um bloco completo e total para cada uma.
- Falha na segunda atualização multirrefeição com restauração da primeira e da chamada que falhou.
- Resposta conservadora quando uma compensação também falha.
- Metadados de contexto dos módulos com pendências.
- Cancelamento, estado obsoleto, clique duplo e isolamento entre usuários continuam cobertos pelo mecanismo central de callbacks.

## CI TiDB

O workflow `WhatsApp context TiDB gate` aguarda uma consulta SQL `SELECT 1` bem-sucedida antes de criar o banco de validação. Abrir somente a porta TCP não é considerado sinal de prontidão do servidor.

## Validação obrigatória

A entrega somente pode ser considerada pronta para merge quando os seguintes checks executarem e passarem:

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`
- `pnpm docs:check`
- `pnpm build`
- `pnpm agent:check`
- workflow `WhatsApp context TiDB gate`
- workflow `Agent-first gate`

## Correções finais após auditoria

- Respostas de refeições novas, inclusive no webhook de imagem anotada, passam a renderizar itens e totais a partir da refeição persistida retornada pelo domínio, nunca do payload anterior à gravação.
- Aumento e redução de gramas preservam a refeição explicitamente informada durante resolução clara, ambiguidade, seleção interativa e mutação.
- Os testes de regressão cobrem divergência entre inferência e persistência, alimento repetido em refeições diferentes e candidatos ambíguos limitados ao escopo explícito.

