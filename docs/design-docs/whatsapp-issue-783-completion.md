# Conclusão técnica da issue #783

Este documento complementa e substitui as limitações anteriormente registradas para a issue #783 em `docs/design-docs/whatsapp-ingestion.md`.

## Contrato final

Todos os caminhos alcançáveis pelo webhook e pelo simulador reutilizam os builders centrais de refeição e os mesmos mecanismos de seleção/confirmacão persistida.

- Itens `heuristic` e `hybrid` exibem individualmente `⚠️ Valores nutricionais estimados pela IA.`. Itens `catalog` não exibem o aviso.
- Candidatos ambíguos preservam `mealId`, rótulo da refeição, índice e nome do item.
- Dois itens iguais ou semelhantes dentro da mesma refeição permanecem candidatos distintos; o primeiro não é escolhido silenciosamente.
- Ambiguidades entre refeições diferentes usam a mesma lista interativa da #782.
- Mensagens com ações claras e ambíguas são atômicas em relação à seleção: nenhuma chamada de atualização é feita antes de todas as escolhas.
- Quando existem várias ambiguidades, as pendências são encadeadas. Cada escolha é acumulada como ação resolvida, mas a escrita só ocorre após a última seleção.
- Cada ação de substituição mantém o respectivo alimento de destino durante todo o encadeamento.
- Antes de escrever, todos os alvos são recarregados e revalidados contra o estado atual. Mudanças concorrentes tornam o plano obsoleto e bloqueiam todas as alterações.
- Depois da execução, cada refeição afetada é renderizada integralmente, com itens e totais atuais.
- `recordAdjustmentIntent.ts`, `gramsAdjustmentIntent.ts` e `gramsIncrementIntent.ts` delegam aos mesmos handlers canônicos. Exclusões continuam exigindo confirmação.
- Os módulos que criam ou consomem pendências declaram `usesPendingOperation: true` e `requiresFreshDbQuery: true`.

## Principais módulos

- `server/modules/whatsapp/mealItemSelectionCallback.ts`: persistência, encadeamento, revalidação e aplicação do plano.
- `server/modules/whatsapp/intent/mealTargetResolution.ts`: identidade de refeição por candidato.
- `server/modules/whatsapp/intent/gramsAdjustmentHandlers.ts`: ajustes absolutos, incrementos, reduções e correções de quantidade.
- `server/modules/whatsapp/intent/foodReplacementHandlers.ts`: substituições estruturadas.
- `server/modules/whatsapp/contextualFoodReplacementIntent.ts`: substituições contextuais recentes.
- `server/modules/whatsapp/recordAdjustmentIntent.ts`: compatibilidade do simulador/handler legado.

## Regressões cobertas

- Origem nutricional `catalog`, `heuristic`, `hybrid`, refeição mista e vários itens estimados.
- Ambiguidade dentro da mesma refeição e entre refeições.
- Ação clara junto de ação ambígua sem mutação parcial.
- Várias substituições ambíguas com destinos diferentes.
- Atualização de várias refeições com um bloco completo e total para cada uma.
- Metadados de contexto dos módulos com pendências.
- Cancelamento, estado obsoleto, clique duplo e isolamento entre usuários continuam cobertos pelo mecanismo central de callbacks.

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
