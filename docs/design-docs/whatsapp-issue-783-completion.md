# Conclusão técnica da issue #783

Este documento registra o contrato final da issue #783. A seção equivalente em `docs/design-docs/whatsapp-ingestion.md` deve permanecer coerente com estas regras.

## Contrato final

Todos os caminhos alcançáveis pelo webhook e pelo simulador reutilizam os builders centrais de refeição e os mesmos mecanismos de seleção/confirmação persistida.

- Itens `heuristic` e `hybrid` exibem individualmente `⚠️ Valores nutricionais estimados pela IA.`. Itens `catalog` não exibem o aviso.
- Candidatos ambíguos preservam `mealId`, rótulo da refeição, índice e nome do item.
- Dois itens iguais ou semelhantes dentro da mesma refeição permanecem candidatos distintos; o primeiro não é escolhido silenciosamente.
- Ambiguidades entre refeições diferentes usam a mesma lista interativa da #782.
- Mensagens com ações claras e ambíguas são atômicas em relação à seleção: nenhuma chamada de atualização é feita antes de todas as escolhas.
- Quando existem várias ambiguidades, inclusive vários ajustes de gramas na mesma mensagem, as pendências são encadeadas em `remainingSelections`. Cada escolha é acumulada como ação resolvida e a escrita só ocorre após a última seleção.
- Cada ação de substituição ou ajuste mantém o respectivo alimento de destino, delta ou quantidade durante todo o encadeamento.
- Antes de escrever, todos os alvos são recarregados e revalidados contra o estado atual. Mudanças concorrentes tornam o plano obsoleto e bloqueiam todas as alterações.
- Operações que alteram mais de uma refeição usam `mealBatchMutation.ts`. Se qualquer atualização falhar, todas as refeições tentadas são restauradas em ordem inversa, inclusive a chamada que lançou erro, evitando manter uma alteração parcial silenciosa.
- Quando a compensação completa não puder ser confirmada, a resposta não afirma que os dados foram restaurados e orienta o usuário a consultar o estado atual.
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
