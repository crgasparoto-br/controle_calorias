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

| Interação | Ações/entrada | Resolução textual | Resposta inválida | Estado obsoleto/expirado |
|---|---|---|---|---|
| Exclusão — confirmação | Confirmar / Cancelar | SIM / CANCELAR | reapresenta os dois botões sem mutação | indisponível; solicitar novo comando |
| Exclusão — seleção | candidatos / Cancelar | índice ou ordinal / CANCELAR | reapresenta mesmas opções e ordem | indisponível; não excluir |
| Seleção para ajuste/substituição | candidatos / Cancelar | índice ou ordinal / CANCELAR | reapresenta mesma interação | revalidar refeição e item |
| Confirmação genérica | Confirmar / Cancelar | SIM / CANCELAR | reapresenta sem consumir | revalidar alvo atual |
| Reclassificação ambígua | Só compatíveis / Todos recentes / Cancelar | APENAS / TODOS / CANCELAR | `sim` não escolhe escopo | reconsultar registros recentes |
| Período de resumo | Hoje / Ontem / Esta semana / Este mês / Cancelar | período / CANCELAR | reapresenta lista | não gerar resumo |
| Autorização profissional | Autorizar / Recusar | AUTORIZAR / NEGAR | reapresenta após recarregar domínio | indisponível se solicitação não estiver pendente |
| Clarificação genérica | Registrar / Corrigir / Consultar / Cancelar | número, rótulo ou CANCELAR | preserva mensagem original e reapresenta | não persistir comando isolado |
| Alimento — quantidade | valor e unidade | quantidade compatível | repete pergunta específica | preservar alimento original |
| Alimento — confirmação | Confirmar / Cancelar | confirmação/cancelamento | reapresenta sem criar alimento | indisponível; sem fallback de 100 g |
| Alimento — seleção | candidatos / Cancelar | opção válida / CANCELAR | reapresenta mesma ordem | preservar candidato e qualificadores |

## Segurança e idempotência

Os testes devem provar:

- callback repetido ou reentregue aplica no máximo uma mutação;
- callback adulterado é rejeitado antes do domínio;
- callback de outro usuário não consome a pendência do proprietário;
- callback de canal incompatível não consome a pendência;
- callback consumido, cancelado ou expirado responde indisponibilidade;
- resposta inválida não cria nova pendência equivalente;
- resposta inválida não alcança parser, LLM ou fallback nutricional;
- novo comando completo incompatível substitui a pendência anterior e segue o roteador normal;
- ação desconhecida recuperável não altera o recurso.

## Paridade

A mesma regra deve ser validada em:

1. webhook HTTP textual;
2. callback `button_reply`;
3. callback `list_reply`;
4. áudio transcrito retornando ao pipeline textual;
5. `simulateWhatsappInbound`;
6. envio independente de autorização profissional.

## Gates automatizados

A implementação mantém testes para:

- versão, unicidade e campos obrigatórios do registro;
- descoberta automática de todos os `PENDING_*_TYPE` exportados;
- ausência de lista ou switch paralelo no `messageRouter.ts`;
- correspondência entre ações do registro e builders dos produtores;
- cardinalidade 1, 2, 3, 4 e maior que 4;
- contratos alimentares abertos e fechados da issue #855;
- baixa confiança do LLM produzindo clarificação genérica interativa;
- clarificação de segurança específica permanecendo textual;
- preservação da pendência após reapresentação no webhook;
- gate persistente do simulador antes da chamada nutricional;
- produtores principais sem uso direto de `buttonsReply` ou `listReply`.
