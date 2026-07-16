# Segunda rodada de validação da epic #779

Esta rodada alinhou a suíte de regressão ao contrato final do WhatsApp
(fast path sem acknowledgement, templates centrais de mídia e erros) e
implementou as correções funcionais identificadas pela auditoria:

- ambiguidades de substituição/ajuste interpretadas pela IA seguem para a
  seleção persistente em `whatsappPendingOperations`, enquanto substituições
  claras executam diretamente após validação do backend
  (`autonomyPolicy.ts` + `intentValidation.ts`);
- calorias de exercícios com a mesma referência externa (ex.: `strava:<id>`)
  são somadas uma única vez no contexto de meta do WhatsApp
  (`goalProgressContext.ts`);
- água e alimento na mesma mensagem produzem uma única resposta funcional
  composta (`deferredLogicalReply.ts`);
- clarificação de resumo sem período usa lista interativa resolvida pelo gate
  central de callbacks (`periodReportClarification.ts`);
- `processedAt` é marcado nos webhooks base e anotado após a resposta
  funcional, sem antecipação.

Todos os itens estão cobertos por testes na suíte oficial (`pnpm test`).
