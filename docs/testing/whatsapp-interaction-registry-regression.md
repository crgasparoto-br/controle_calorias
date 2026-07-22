# Matriz de regressão — interações do WhatsApp

Esta matriz complementa `whatsapp-response-contract-regression.md` com os cenários transversais da issue #858.

## Regras de componente

| Cenário | Componente esperado | Ações totais |
|---|---|---:|
| Confirmar + Cancelar | botões | 2 |
| 1 candidato + Cancelar | botões | 2 |
| 2 candidatos + Cancelar | botões | 3 |
| 3 candidatos + Cancelar | lista | 4 |
| 4 ou mais candidatos + Cancelar | lista | 5 ou mais |
| Quantidade, marca ou tamanho não enumerável | texto | não aplicável |

## Matriz funcional

| Interação | Resolução textual | Resposta inválida | Estado obsoleto/expirado |
|---|---|---|---|
| Exclusão — confirmação | SIM / CANCELAR | reapresenta sem mutação | indisponível; solicitar novo comando |
| Exclusão — seleção | índice ou ordinal / CANCELAR | reapresenta mesma ordem | indisponível; não excluir |
| Seleção para ajuste/substituição | índice ou ordinal / CANCELAR | reapresenta mesma interação | revalidar refeição e item |
| Confirmação genérica | SIM / CANCELAR | reapresenta sem consumir | revalidar alvo persistido |
| Reclassificação ambígua | APENAS / TODOS / CANCELAR | `sim` não escolhe escopo | validar exatamente `mealIds`/`allMealIds` |
| Período de resumo | período / CANCELAR | reapresenta lista | não gerar resumo |
| Autorização profissional | AUTORIZAR / NEGAR | reapresenta após recarregar domínio | indisponível se não estiver pendente |
| Clarificação genérica | número, rótulo ou CANCELAR | preserva mensagem original | não persistir comando isolado |
| Alimento — quantidade | quantidade compatível | repete pergunta específica | preservar alimento original |
| Alimento — confirmação | confirmação/cancelamento | reapresenta sem criar alimento | sem fallback de 100 g |
| Alimento — seleção | opção válida / CANCELAR | reapresenta mesma ordem | preservar candidato e qualificadores |

## Cenários discriminantes da auditoria

Os seguintes testes são obrigatórios porque diferenciam a implementação correta de uma solução apenas estrutural:

1. uma transcrição de áudio dentro do escopo persistente da mensagem resolve uma pendência antes da inferência nutricional;
2. escolher Registrar alimento retoma `originalText` quando ele contém dados suficientes e cria a clarificação específica quando necessário;
3. uma refeição criada depois da pergunta não entra em “Todos recentes”; apenas `allMealIds` persistidos podem ser alterados;
4. cancelar por callback produz `interactionLifecycle=cancelled`, enquanto confirmar produz `consumed`;
5. cada entrada do registro possui `actions`, `classifyText`, `resolveText`, `rebuild` e `completeCallback` executáveis;
6. o roteador, o gate e o registro não mantêm switch ou cadeia paralela por tipo de pendência.

## Segurança e idempotência

Os testes devem provar:

- callback repetido ou reentregue aplica no máximo uma mutação;
- callback adulterado é rejeitado antes do domínio;
- callback de outro usuário não consome a pendência do proprietário;
- callback de canal incompatível não consome a pendência;
- callback consumido, cancelado ou expirado responde indisponibilidade;
- resposta inválida não cria nova pendência equivalente;
- resposta inválida não alcança parser, LLM ou fallback nutricional;
- comando completo incompatível substitui a pendência anterior e segue o roteador normal;
- ação desconhecida recuperável não altera o recurso.

## Paridade

A mesma regra deve ser validada em:

1. webhook HTTP textual;
2. callback `button_reply`;
3. callback `list_reply`;
4. áudio transcrito no escopo persistente;
5. `simulateWhatsappInbound`;
6. envio independente de autorização profissional.

## Gates automatizados

A implementação mantém testes para:

- versão, unicidade e handlers obrigatórios do registro;
- descoberta automática de todos os `PENDING_*_TYPE` exportados;
- ausência de roteamento paralelo por tipo;
- correspondência entre ações do registro e builders dos produtores;
- cardinalidade 1, 2, 3, 4 e maior que 4;
- contratos alimentares abertos e fechados da issue #855;
- baixa confiança do LLM produzindo clarificação genérica interativa;
- clarificação de segurança específica permanecendo textual;
- preservação da pendência após reapresentação;
- gate persistente do simulador e da transcrição antes da nutrição;
- produtores principais sem uso direto de `buttonsReply` ou `listReply`.