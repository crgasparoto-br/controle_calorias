# Contexto conversacional persistente do WhatsApp

Épico: #762. Implementação base: #763 a #767. Gate de rollout e regressão: #768.

## Objetivo

Preservar continuidade entre mensagens de texto, imagem, áudio e multimodais sem usar o histórico como fonte de verdade nutricional e sem permitir que referências ambíguas autorizem alterações indevidas.

## Arquitetura canônica

A solução separa cinco responsabilidades:

1. **Conversa e mensagens persistentes** — `whatsappConversations`, `whatsappConversationMessages` e `whatsappMessageDomainLinks` registram entradas, respostas funcionais e vínculos com registros de domínio.
2. **Janela recente** — recupera mensagens ordenadas por `occurredAt` e `id`, respeitando orçamento por consumidor.
3. **Resumo progressivo** — resume somente o conteúdo que saiu da janela recente, mantém proveniência e nunca congela valores nutricionais como verdade atual.
4. **Pendência operacional** — `whatsappPendingOperations` mantém seleção, confirmação ou informação faltante separada do histórico semântico e com consumo protegido por compare-and-set.
5. **Dados de domínio** — refeições, água, peso, exercícios e metas continuam sendo consultados no banco antes de responder ou executar ações.

## Modelo de dados

- `whatsappConversations`: sessão lógica por usuário e canal, status, atividade, expiração e versão para concorrência otimista.
- `whatsappConversationMessages`: direção, papel, tipo de conteúdo, timestamps de ocorrência/processamento, status, conteúdo permitido/sanitizado, referência segura de mídia e chave idempotente.
- `whatsappMessageDomainLinks`: vínculos tipados com refeições, itens, água, peso e exercícios.
- `whatsappConversationSummaries`: resumos append-only com mensagem inicial/final, versão de prompt e algoritmo.
- `whatsappPendingOperations`: pendências duráveis com tipo, alvo, origem, estado, versão, expiração e consumo.

Mídia binária não é duplicada nas tabelas de conversa. URLs temporárias, tokens, headers e payload bruto da Meta não devem ser persistidos em logs ou métricas.

## Ordem dos handlers

A ordem funcional é:

1. validar canal, usuário, tipo e idempotência;
2. registrar a entrada pelo lifecycle canônico;
3. comandos explícitos com precedência, incluindo `/`;
4. pendência operacional ativa;
5. intenção atual;
6. contexto conversacional para resolver referências;
7. consulta ao banco como fonte de verdade;
8. clarificação segura quando o alvo continuar ambíguo;
9. persistência do resultado e vínculo de domínio;
10. gravação da resposta funcional e encerramento do lifecycle.

Acknowledgements intermediários de processamento não substituem a resposta funcional no histórico.

## Orçamento e resumo

Os limites são definidos por consumidor em `conversationContextBudget.ts`. O corte é determinístico: percorre as mensagens mais recentes para trás, não divide uma mensagem e mantém ao menos a mensagem mais recente. Quando há overflow, o resumo é regenerado de forma idempotente e protegido contra gravações concorrentes.

Falha do resumo não interrompe o atendimento. O fallback usa janela recente disponível, dados atuais do banco e clarificação quando necessário.

## Idempotência e concorrência

- A chave de idempotência baseada no `message.id` da Meta possui unicidade no banco.
- Reentrega não cria nova mensagem nem repete ação de domínio já vinculada.
- Atualização de conversa e consumo de pendência usam versão/compare-and-set.
- Duas instâncias podem processar mensagens sobre o mesmo armazenamento sem depender de lock em memória.
- A ordenação lógica usa `occurredAt` e `id`, não a ordem de inserção.

Caches locais podem existir apenas como fast-path. Eles não são a fronteira de correção.

## Segurança de ações

O histórico semântico ajuda a entender `isso`, `o segundo`, `e a proteína?` ou `agora quanto ficou?`, mas não autoriza sozinho alteração ou exclusão. Antes de mutar:

- o registro é resolvido novamente no banco;
- itens removidos ou alterados invalidam referências antigas;
- múltiplos candidatos exigem seleção ou confirmação;
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
- quantidade de mensagens recuperadas;
- resumo utilizado ou falho;
- duplicidade e conflito de concorrência;
- fallback para banco ou clarificação;
- latência, tamanho e custo quando disponíveis;
- erro de persistência ou envio.

O runbook operacional é `docs/runbooks/whatsapp-conversation-context-diagnosis-767.md`.

## Rollout

O rollout não exige migration destrutiva:

1. escrita persistente com leitura antiga preservada;
2. observação e comparação entre contexto antigo e persistente;
3. leitura persistente para o classificador textual;
4. ativação dos fluxos de imagem e áudio;
5. validação de equivalência e estabilidade;
6. remoção de fallback local apenas quando busca no repositório e testes provarem ausência de consumidores de produção.

Critérios mínimos para avançar por etapa durante uma janela controlada:

- nenhuma duplicação de domínio atribuível ao contexto;
- nenhuma ação ambígua executada automaticamente;
- taxa de erro de persistência e resumo sem tendência de crescimento;
- ausência de divergência funcional crítica entre contexto antigo e novo;
- latência do contexto dentro do orçamento operacional definido para o ambiente;
- payloads e métricas sem conteúdo sensível.

## Rollback

O rollback desativa a leitura do contexto persistente por fluxo e mantém a escrita ativa. As mensagens já gravadas permanecem disponíveis para auditoria e futura reativação. Não remover tabelas, colunas ou migrations durante rollback operacional.

Quando não houver configuração dinâmica no ambiente, o rollback é feito restaurando a versão anterior da aplicação compatível com o schema aditivo. O banco não precisa de downgrade.

## Comportamento degradado

Se o armazenamento de contexto estiver indisponível:

- preservar idempotência e gravação de domínio já protegidas pelo banco quando disponíveis;
- consultar dados atuais do usuário;
- responder mensagens explícitas normalmente;
- pedir esclarecimento para referências curtas ou ações ambíguas;
- registrar evento operacional sem conteúdo sensível;
- nunca confirmar sucesso de uma mutação que não foi persistida.

## Matriz de regressão

A matriz consolidada e o roteiro de staging estão em `docs/testing/whatsapp-conversation-context-regression.md`. Ela cobre entrypoints reais de texto, imagem, áudio e multimodal, profundidades de 2 a 20 turnos, reinício, duas instâncias, concorrência, reentrega, fora de ordem, falha de resumo, retenção e resposta da Meta após persistência.

## Limites conhecidos

- O resumo não substitui consulta atual ao banco.
- O histórico não é um chat ilimitado.
- Caches locais só podem ser removidos após prova de equivalência.
- Testes com payloads reais da Meta e staging controlado continuam obrigatórios antes de promoção para produção.