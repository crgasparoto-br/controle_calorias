# Contexto conversacional persistente do WhatsApp

Épico: #762. Implementação base: #763 a #767. Gate de rollout e regressão: #768.

## Objetivo

Preservar continuidade entre mensagens de texto, imagem, áudio e multimodais sem usar o histórico como fonte de verdade nutricional e sem permitir que referências ambíguas autorizem alterações indevidas.

## Arquitetura canônica

O POST `/api/whatsapp/webhook` usa `handleWhatsAppPersistentContextWebhook`. Esse entrypoint abre um escopo único de lifecycle e envolve o gateway `handleWhatsAppWebhookWithImageIdempotency`, que encadeia intenção textual, imagem anotada e webhook nutricional base.

A solução separa seis responsabilidades:

1. **Conversa e mensagens persistentes** — `whatsappConversations`, `whatsappConversationMessages` e `whatsappMessageDomainLinks` registram entradas, respostas funcionais e vínculos com registros de domínio.
2. **Propriedade de processamento** — a chave baseada no `message.id` da Meta e um lease atômico garantem uma única instância proprietária por tentativa.
3. **Janela recente** — recupera mensagens ordenadas por `occurredAt` e `id`, respeitando orçamento por consumidor e excluindo a mensagem corrente do histórico entregue ao classificador.
4. **Resumo progressivo** — resume somente o conteúdo que saiu da janela recente, mantém proveniência e nunca congela valores nutricionais como verdade atual.
5. **Pendência operacional** — `whatsappPendingOperations` mantém seleção, confirmação ou informação faltante separada do histórico semântico e com consumo protegido por compare-and-set.
6. **Dados de domínio** — refeições, água, peso, exercícios e metas continuam sendo consultados no banco antes de responder ou executar ações.

## Modelo de dados

- `whatsappConversations`: sessão lógica por usuário e canal, status, atividade, expiração e versão para concorrência otimista.
- `whatsappConversationMessages`: direção, papel, tipo de conteúdo, timestamps de ocorrência/processamento, conteúdo permitido/sanitizado, referência segura de mídia e chave idempotente.
- `whatsappMessageDomainLinks`: vínculos tipados com refeições, itens, água, peso e exercícios.
- `whatsappConversationSummaries`: resumos append-only com mensagem inicial/final, versão de prompt e algoritmo.
- `whatsappPendingOperations`: pendências duráveis com tipo, alvo, origem, estado, versão, expiração e consumo.

Mídia binária não é duplicada nas tabelas de conversa. URLs temporárias, tokens, headers e payload bruto da Meta não devem ser persistidos em logs ou métricas. Imagem e áudio recebidos usam chave de storage opaca e enriquecem a mesma mensagem inbound depois do processamento.

## Ordem dos handlers

A ordem funcional é:

1. validar canal, usuário e tipo;
2. registrar a entrada pelo lifecycle canônico;
3. adquirir propriedade persistente do processamento;
4. comandos explícitos com precedência, incluindo `/`;
5. pendência operacional ativa;
6. intenção atual;
7. contexto conversacional para resolver referências;
8. consulta ao banco como fonte de verdade;
9. clarificação segura quando o alvo continuar ambíguo;
10. persistência do resultado e vínculo de domínio;
11. gravação da resposta funcional;
12. finalização de `processedAt` somente quando o escopo HTTP termina com sucesso.

Acknowledgements intermediários de processamento não substituem a resposta funcional no histórico. Uma exceção descarta a finalização pendente e mantém a mensagem recuperável após o vencimento do lease.

## Orçamento e resumo

Os limites são definidos por consumidor em `conversationContextBudget.ts`. O corte é determinístico: percorre as mensagens mais recentes para trás, não divide uma mensagem e mantém ao menos a mensagem mais recente. A mensagem inbound corrente é removida da janela antes da classificação para não duplicar o texto atual nem produzir divergência shadow artificial.

Quando há overflow, o resumo é regenerado de forma idempotente e protegido contra gravações concorrentes. Falha do resumo não interrompe o atendimento: o fallback usa a janela disponível, dados atuais do banco e clarificação quando necessário.

## Idempotência e concorrência

- A chave de idempotência baseada no `message.id` da Meta possui unicidade no banco.
- Uma inserção nova recebe propriedade imediatamente; reentrega só retoma uma mensagem não processada quando o lease está vencido.
- Reentrega de mensagem concluída não cria nova entrada nem repete ação de domínio.
- Atualização de conversa e consumo de pendência usam versão/compare-and-set.
- Duas instâncias podem processar mensagens sobre o mesmo armazenamento sem depender de lock em memória.
- A ordenação lógica usa `occurredAt` e `id`, não a ordem de conclusão de download ou transcrição.
- `processedAt` só é efetivado ao final de um escopo bem-sucedido.

Caches locais podem existir apenas como fast-path. Quando o lease persistente concede propriedade, a requisição ignora esses caches. Eles não são a fronteira de correção.

## Segurança de ações

O histórico semântico ajuda a entender `isso`, `o segundo`, `e a proteína?` ou `agora quanto ficou?`, mas não autoriza sozinho alteração ou exclusão. Antes de mutar:

- o registro é resolvido novamente no banco;
- itens removidos ou alterados invalidam referências antigas;
- múltiplos candidatos geram uma pendência `selection` persistida;
- `o segundo` apenas seleciona o candidato e cria nova confirmação;
- somente uma confirmação posterior `sim` consome a pendência e executa uma vez;
- contexto expirado não resolve silenciosamente alvo destrutivo;
- resposta do assistente não é reinterpretada como instrução do usuário;
- conteúdo bloqueado pelo guard de prompt injection não entra em resumo confiável.

## Expiração e retenção

A expiração encerra a conversa ativa, mas não apaga imediatamente o histórico. Depois da expiração, referências vagas devem pedir esclarecimento.

A retenção usa classes já existentes:

- bruto/transcrição permitidos: retenção efêmera;
- conteúdo sanitizado operacional: retenção operacional;
- metadados/auditoria: retenção de auditoria;
- pendências inativas: removidas após a janela operacional;
- resumo anterior: marcado como superado quando um novo resumo é criado.

A rotina de limpeza nunca exclui refeições, água, peso, exercícios ou metas.

## Observabilidade

Eventos de contexto registram, sem conteúdo de mensagem:

- contexto encontrado, ausente, truncado ou expirado;
- modo, fluxo, origem escolhida e elegibilidade do rollout;
- quantidade de mensagens legadas e persistentes;
- equivalência da janela;
- equivalência funcional de intenção, alvo e confirmação;
- resumo utilizado ou falho;
- duplicidade e conflito de concorrência;
- fallback para banco ou clarificação;
- latência, tamanho e custo quando disponíveis;
- erro de persistência ou envio.

A comparação funcional calcula o fingerprint do alvo somente em memória. Logs guardam apenas os booleanos de equivalência, nomes das intenções, fontes e status de validação; texto, alimentos e fingerprints não são registrados.

O runbook operacional é `docs/testing/whatsapp-conversation-context-regression.md`.

## Rollout

O padrão seguro é escrita nova com leitura antiga:

- `WHATSAPP_CONTEXT_READ_MODE=write_only` quando não há configuração explícita;
- `WHATSAPP_CONTEXT_ROLLOUT_PERCENT=0` quando não há configuração explícita;
- sobrescritas por `TEXT`, `IMAGE`, `AUDIO` e `MULTIMODAL` permitem ativação independente;
- `WHATSAPP_CONTEXT_SHADOW_COMPARE_INTENT=true` habilita comparação funcional adicional somente para a amostra elegível em shadow.

A sequência operacional é:

1. `write_only`: escrita persistente, leitura legada;
2. `shadow`: os dois contextos são montados, mas a resposta continua usando legado;
3. comparação estruturada opt-in de intenção/alvo na amostra definida pelo percentual;
4. `persistent` para pequena amostra textual;
5. ampliação textual e ativação separada de imagem, áudio e multimodal;
6. 100% somente após critérios e staging aprovados;
7. remoção física de fallback local apenas quando busca no repositório e testes provarem ausência de consumidores de produção.

Critérios mínimos para avançar por etapa durante uma janela controlada:

- nenhuma duplicação de domínio atribuível ao contexto;
- nenhuma ação ambígua executada automaticamente;
- taxa de erro de persistência e resumo sem tendência de crescimento;
- ausência de divergência funcional crítica entre contexto antigo e novo;
- latência do contexto dentro do orçamento operacional definido para o ambiente;
- payloads e métricas sem conteúdo sensível;
- gates do repositório e TiDB verdes.

## Rollback

O rollback altera o fluxo afetado para `legacy` ou `write_only` e mantém a escrita persistente. Mensagens, resumos, pendências e vínculos existentes não são apagados. Não remover tabelas, colunas ou migrations durante rollback operacional.

Como a configuração é por fluxo e percentual, o rollback não exige restaurar uma versão anterior da aplicação nem executar downgrade do banco.

## Comportamento degradado

Se o armazenamento de contexto estiver indisponível:

- usar a leitura legada quando disponível;
- consultar dados atuais do usuário;
- responder mensagens explícitas normalmente;
- pedir esclarecimento para referências curtas ou ações ambíguas;
- registrar evento operacional sem conteúdo sensível;
- nunca confirmar sucesso de uma mutação que não foi persistida.

## Matriz de regressão

A matriz consolidada, os testes executáveis, o gate TiDB e o roteiro de staging estão em `docs/testing/whatsapp-conversation-context-regression.md`. Ela cobre entrypoint HTTP canônico, texto, imagem, áudio, multimodal, profundidade, reinício, duas instâncias, concorrência, reentrega, falha downstream, seleção/confirmação, shadow, rollback e retenção.

## Limites conhecidos

- O resumo não substitui consulta atual ao banco.
- O histórico não é um chat ilimitado.
- A comparação funcional shadow adiciona custo de classificação e deve ser ligada apenas em janela controlada.
- Caches locais só podem ser removidos fisicamente após prova de equivalência em produção.
- Testes com payloads reais da Meta e staging controlado continuam obrigatórios antes de promoção para produção.
