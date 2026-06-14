# Contexto conversacional do WhatsApp

## Contexto

A issue #420 inicia a camada de contexto multi-turn do WhatsApp. O objetivo é impedir que respostas curtas, seleções, confirmações e referências como `isso`, `a segunda opção` ou `não` caiam no parser nutricional sem uma pendência compatível.

Esta primeira versão é deliberadamente incremental: cria contexto explícito em memória, com expiração previsível, consumo seguro e rastreio operacional. Ela não aplica alterações destrutivas nem substitui validações de backend.

## Implementação inicial

O módulo `server/modules/whatsapp/conversationContext.ts` mantém pendências recentes por usuário com:

- `id`: identificador da pendência.
- `kind`: `selection` ou `confirmation`.
- `createdAt` e `expiresAt`.
- `originalText`: mensagem que abriu a pendência.
- `options`: opções válidas quando a pendência for seleção.
- `metadata`: origem operacional, como ajuste de registro ou confirmação.

O TTL padrão é de 10 minutos. Pendências expiradas são removidas antes de consulta e, quando o usuário responde com mensagem curta dependente de contexto, a resposta expirada é bloqueada antes do parser nutricional.

## Integração no pipeline

No `simulateWhatsappInbound`, a etapa `conversation_context` roda depois da idempotência e antes de acessos profissionais, intenções determinísticas, ajustes de registros, assistente alimentar e roteador canônico.

A etapa faz duas coisas:

1. tenta consumir uma pendência ativa quando a nova mensagem é número, ordinal, confirmação ou cancelamento;
2. registra nova pendência quando uma intenção anterior retorna seleção ou confirmação necessária.

Se a pendência é consumida, o pipeline retorna uma resposta contextual segura e não chama o parser nutricional.

## Comportamentos cobertos

- `2` com seleção ativa vira `conversation_context_selection_received`.
- `a segunda opção` com seleção ativa consome a opção correspondente.
- `não` com confirmação ativa vira `conversation_context_cancelled`.
- `sim` com confirmação ativa vira `conversation_context_confirmation_received`.
- seleção fora da faixa pede uma opção válida e mantém a pendência.
- resposta curta para pendência expirada retorna `conversation_context_expired` e não salva alimento.

## Observabilidade

A decisão aparece no trace operacional como etapa `conversation_context`, registrando:

- presença de contexto ativo;
- tipo da pendência;
- ação contextual consumida;
- criação de nova pendência quando aplicável.

Também é registrado evento `whatsapp.context.pending_created` quando uma seleção ou confirmação abre pendência para a próxima mensagem.

## Limitações atuais

- O armazenamento é em memória, adequado para a primeira entrega e testes, mas não persistente entre processos.
- A seleção consumida ainda não executa a alteração final; ela apenas impede interpretação alimentar indevida e preserva o vínculo contextual.
- As opções ainda usam metadados mínimos quando a origem não envia labels estruturados.
- Referências amplas como `isso`, `o mesmo do almoço` e `a refeição anterior` ainda exigem integração futura com histórico durável e estado de refeição.

## Próximos encaixes

- #425 deve padronizar perguntas de esclarecimento e opções estruturadas.
- #421 deve usar o mesmo contexto para datas e horários relativos por fuso do usuário.
- #422 deve reaproveitar pendências e contexto para múltiplas ações em uma mensagem.
- #419 deve persistir e aplicar confirmações profissionais/paciente com aceite explícito.
