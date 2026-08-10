# Confiabilidade

## Mensagens profissionais

- Persistir a mensagem lógica antes da entrega; disponibilidade na web e evento de criação ficam na mesma transação da mensagem.
- Revalidar autorização aprovada, perfil ativo e situação do acompanhamento sob lock dentro dessa transação antes do `INSERT`; validação anterior à transação serve apenas como preparação e não autoriza a escrita.
- Replay equivalente conclui somente a ação originalmente solicitada quando ela ficou incompleta: `send_web` finaliza o mesmo registro e `send_whatsapp` retoma a entrega pendente sem criar outra mensagem lógica.
- Claims e números de tentativa vivem no banco para suportar múltiplas instâncias.
- Retry manual reutiliza o mesmo identificador lógico, exige uma entrega WhatsApp anterior em `failed` e cria apenas nova tentativa física; rascunhos nunca são convertidos em primeira entrega pelo endpoint de retry.
- A listagem profissional devolve uma capacidade `retryable` derivada dessas condições canônicas; o cliente não reconstrói a política por enums parciais.
- Falha de canal mantém o conteúdo disponível na web com estado `failed` e detalhe sanitizado.
- Respostas repetidas usam o identificador externo do inbound como chave idempotente.
- Mensagem recebida, avanço da conversa e evento de histórico são persistidos na mesma transação antes de confirmar sucesso ao paciente.
- Uma resposta só é classificada como repetida após erro de chave única e releitura do registro idempotente no mesmo vínculo; timeout, indisponibilidade ou outro erro de persistência nunca produzem confirmação de recebimento.

## Objetivo

Garantir que os fluxos críticos possam ser validados por humanos e agentes antes de deploy ou merge.

## Fluxos críticos

- Autenticação e sessão.
- Registro de refeição por texto, imagem e áudio.
- Confirmação de rascunho de refeição.
- Relatórios e dashboard.
- Integrações de saúde, incluindo OAuth, sincronização automática do Strava e exibição de métricas detalhadas de atividades.
- WhatsApp inbound e outbound.
- Exportação e exclusão de dados.
- Migrações e integridade referencial.
- Elegibilidade, capacidade profissional e eventos idempotentes de billing.
- Migração da camada de IA para OpenAI, conforme `docs/exec-plans/active/migrate-ai-to-openai.md`.

## Gates recomendados

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

Quando houver `DATABASE_URL` disponível:

```bash
pnpm db:check-integrity
```

## Estratégia de testes

- Testes unitários para cálculos nutricionais e validação de schemas.
- Testes de serviço para confirmação de refeição, metas e WhatsApp.
- Testes de serviço para integrações de saúde devem cobrir paginação, idempotência, atividade sem calorias no resumo, fallback estimado para treino de força, metadados detalhados do Strava e falhas externas controladas.
- Smoke tests futuros para web, WhatsApp e banco.
- Checks estruturais para impedir drift de arquitetura e documentação.
- Para migração OpenAI, testes de caracterização antes da troca de provider e mocks para transcrição, texto, imagem e falha externa.
- Para visual auxiliar opcional, testes devem provar que falhas do provider não bloqueiam análise nem confirmação da refeição.
- Para `IMAGE_ANNOTATION`, testes devem distinguir `local`, `external` e `off`, provar ausência de rede no default local, preservar os bytes originais, limitar uma chamada por tentativa e manter falhas locais/externas não bloqueantes.

## Pendências multietapas do WhatsApp

- Persistir a operação pendente antes de emitir pergunta, botão ou solicitação cuja resposta dependa do contexto salvo.
- Memória do processo pode apoiar somente testes ou desenvolvimento não produtivo explicitamente habilitado; nunca representa durabilidade entre reinícios ou instâncias.
- Em produção, banco ausente, conexão indisponível ou erro do provider deve fazer criação, leitura, claim e transições falharem fechado, com diagnóstico sanitizado.
- Falha de persistência não pode produzir pergunta órfã, mutação de domínio, evento de sucesso nem resposta funcional que pressuponha estado recuperável.
- Testes discriminantes devem chamar o repository real em ambiente de produção equivalente e cobrir dependência indisponível, reinício e segunda instância quando a continuidade exigir durabilidade.

## Incidentes comuns a prevenir

- Migração não aplicada em produção.
- Divergência entre rascunho e confirmação.
- Log de dados sensíveis.
- Falha silenciosa no envio WhatsApp.
- Pergunta de clarificação enviada sem estado durável recuperável após reinício ou em outra instância.
- Relatório semanal divergente do dashboard.
- Meta profissional divergente entre Hoje, Metas, Relatórios, WhatsApp e prontuário.
- Falha de notificação revertendo ou duplicando a ativação de uma meta profissional já persistida.
- Falha ou inconsistência na resolução de meta profissional degradando silenciosamente para meta pessoal; consumidores da meta efetiva devem falhar de forma controlada para preservar a precedência clínica.
- Integração do Strava limitada à primeira página de atividades recentes.
- Atividade do Strava ignorada porque o resumo não inclui gasto calórico.
- Treino de força do Strava ignorado porque a API não retornou calorias.
- Detalhes do Strava exibidos como obrigatórios quando a API não retorna a métrica.
- Usuário com Strava conectado depender de sync manual para registrar exercícios.
- Falha externa de IA corrompendo rascunhos ou bloqueando confirmação manual.
- Falha de imagem auxiliar bloqueando um fluxo que deveria continuar sem ela.
- Chave ou configuração de IA exposta no frontend.
- Callback duplicado do WhatsApp baixando ou transcrevendo o mesmo áudio novamente.
- Modelo de transcrição sem segmentos sendo rejeitado apesar de retornar texto útil.
- Data URL malformada sendo confundida com arquivo vazio.
- Mudança de `MEAL_VISION` redirecionando silenciosamente um segundo envio da foto para anotação.
- Resumo visual genérico sendo apresentado como anotação da foto original.
- Falha de upload do derivado sobrescrevendo ou removendo o original.
- Fallback externo criando cadeia de providers ou mais de uma operação outbound por tentativa.

## Metas profissionais oficiais

- Ativação e revisão usam transação para versão, encerramento da janela anterior, histórico, resolução de pedido e criação da entrega.
- Concorrência usa versão esperada e chave ativa única por paciente; conflito nunca sobrescreve silenciosamente.
- A notificação acontece depois do commit. Falha fica em `failed`/`skipped`, não reverte a meta e pode ser reclamada por uma única instância para retry.
- O serviço de metas resolve a origem por paciente e data; relatórios continuam consultando o mesmo contrato diário usado por Hoje e WhatsApp.
- Rollout exige aplicar `0032_professional_official_goals.sql` antes de liberar as novas procedures e interfaces.

## Guardrails para integração Strava

- Tokens OAuth ficam criptografados em `appSecrets` e nunca devem ser logados.
- Sincronização automática deve ser idempotente, usando a referência externa `strava:<activityId>` nas notas do exercício.
- A busca de atividades recentes deve paginar o período de lookback configurado para evitar perda de treinos além da primeira página.
- Quando o resumo da atividade não trouxer gasto calórico, buscar o detalhe da atividade antes de decidir pular o exercício.
- O OAuth deve solicitar `activity:read_all` para que atividades privadas ou marcadas como Only Me possam ser importadas após reconexão do usuário.
- Métricas detalhadas do Strava, como distância, duração, elevação, frequência cardíaca, cadência e potência, devem ser tratadas como opcionais na UI e preservadas apenas quando a API retornar esses campos.
- Quando treino de força, HIIT, CrossFit ou workout não retornar calorias, o backend pode estimar o gasto por MET e deve marcar o valor como estimado em metadados, nota do exercício e UI.
- Falhas na sincronização automática devem ser registradas de forma segura e não podem impedir o servidor de iniciar.
- `STRAVA_AUTO_SYNC_INTERVAL_MINUTES` controla o intervalo da rotina; `STRAVA_AUTO_SYNC_DISABLED=true` desativa o agendamento.

## Guardrails para migração OpenAI

- Implementar em fases pequenas, seguindo `docs/exec-plans/active/migrate-ai-to-openai.md`.
- Não misturar migração de autenticação com migração de IA.
- Manter fallback seguro ou erro controlado quando a OpenAI estiver indisponível.
- Confirmação de refeição não deve depender de chamada externa.
- Validar saída de IA com Zod antes de retornar ou persistir.
- Recalcular totais nutricionais no backend a partir dos itens validados.
- Falha de visual auxiliar deve degradar para ausência de imagem, nunca para falha de refeição.
- Falha de leitura da preferência de imagem anotada deve degradar para o estado desabilitado, com diagnóstico sanitizado e sem impedir análise, persistência da foto original, registro ou resposta textual.
- Rodar smoke test web e WhatsApp antes de ativar em produção.

## Fundação multi-provider de IA por capacidade (#921)

`server/_core/ai/` define o registro de capacidades, a matriz de suporte, o resolvedor e o executor comum:

- `QUESTION` exige geração textual e pesquisa web e usa somente o contrato interno estável `{ type: "web_search" }`. `NUTRITION_SEARCH` exige geração textual, Structured Output e pesquisa web; `EMBEDDING` é uma capacidade independente consumida pela busca semântica de catálogo por meio do resolvedor e do executor comuns. Não reutilizar o modelo de embeddings como se executasse pesquisa nutricional.
- A matriz representa somente operações implementadas no adapter do projeto. OpenAI expõe métodos explícitos para texto/multimodal, pesquisa web, embeddings, transcrição e imagem; Gemini suporta texto, visão, Structured Output e Google Search Grounding. Embeddings Gemini permanecem indisponíveis até existir método dedicado e teste de integração.
- Todo campo aceito pelo request comum precisa ser traduzido ou rejeitado localmente. O Gemini traduz somente `web_search` para Google Search Grounding e rejeita qualquer outro tipo de ferramenta antes da rede; nunca descarta ferramenta silenciosamente.
- `OPENAI_BASE_URL` não vazio ativa automaticamente o modo `openai-compatible`; o endpoint começa sem operações suportadas e exige allowlist explícita em `AI_OPENAI_COMPATIBLE_OPERATIONS`.
- Timeout e tentativas inválidos tornam a capacidade `invalid`; não são aceitos como configuração pronta.
- O executor rejeita estados `invalid` e `disabled`, limites não positivos/não inteiros e fallback habilitado sem callback antes de qualquer chamada. Estado `degraded` só executa quando o primário continua válido.
- Variáveis novas prevalecem sobre variáveis legadas. Para os fluxos de texto/visão, a compatibilidade preserva `OPENAI_MODEL` ou `GEMINI_MODEL` conforme o provider efetivo.
- O fallback usa modelo próprio do provider de destino. Um modelo do primário nunca é reutilizado silenciosamente em provider diferente. Em `NODE_ENV=production`, fallback cross-provider permanece inelegível mesmo com opt-in explícito: a #927 não aprovou essa promoção, que exige nova evidência, revisão de privacidade e autorização operacional por capacidade; fallback same-provider continua seguindo a política da capacidade.
- Erros concretos de SDK/HTTP/rede são classificados pelo executor. Timeout, rede, rate limit recuperável, saída vazia, JSON inválido e payload inválido podem acionar a política limitada; autenticação, modelo ausente, bloqueio de segurança, configuração inválida e erro desconhecido não acionam segundo provider.
- Cada tentativa recebe `AbortSignal`; o contrato `AiProvider` e os adapters OpenAI/Gemini propagam o sinal para a chamada do SDK. Depois do timeout, o executor aguarda o encerramento local da chamada antes de retry/fallback; se a chamada não reconhecer o cancelamento na janela definida, a execução termina sem nova chamada. O cancelamento do cliente não deve ser interpretado como garantia de interrupção do processamento remoto ou de ausência de cobrança pelo provider.
- `MAX_ATTEMPTS` é o total de chamadas do primário. Depois delas, existe no máximo uma chamada de fallback, sem retorno ao primário e sem cadeia adicional.
- Escalonamento de qualidade é política separada e não é ativado nesta fase.
- Degradação funcional local, como busca não semântica ou anotação local, não é fallback de provider.
- O adapter Gemini usa `models.generateContent` com `responseJsonSchema`, preservando recursos dos schemas reais do projeto, como `additionalProperties: false`, nulabilidade e limites numéricos. O consumidor legado de refeições possui testes pelo entrypoint real para texto e para o data URL inline de imagem produzido pelo WhatsApp.
- Respostas textuais e de embeddings podem expor metadados normalizados de usage; conteúdo sensível e valores de segredo não entram nos diagnósticos.
- Nenhum consumidor existente foi migrado para o novo resolvedor na issue #921.

## Mutações multirrefeição pelo WhatsApp

Solicitações compostas de ajuste ou substituição usam uma unidade lógica compensável:

- tentativas persistem refeição e snapshots sem incrementar hábitos ou uso de catálogo;
- somente a última escrita do lote reconstrói hábitos de forma idempotente a partir das refeições atuais;
- falha intermediária restaura todas as refeições tentadas em ordem inversa e reconstrói novamente o estado derivado;
- falha durante a restauração nunca comunica sucesso ou restauração completa ao usuário;
- a resposta funcional só é enviada depois do sucesso integral pelo transporte lógico central.

## Consumidores migrados em #922

`MEAL_TEXT`, `MEAL_VISION` e `WHATSAPP_INTENT` usam exclusivamente `executeResolvedCapability`; não mantêm loops locais de timeout/retry. Saída vazia, JSON inválido e payload inválido são recuperáveis dentro dos limites configurados. Erros de autenticação, modelo inexistente, incompatibilidade, segurança, configuração ou desconhecidos falham fechado sem retry/fallback. `items: []` válido encerra a execução na primeira resposta.

## Consumidores migrados em #923

`QUESTION`, `NUTRITION_SEARCH` e `EMBEDDING` usam a mesma fundação (`resolveCapabilityConfig` + `executeResolvedCapability`/`executeWithPolicy`), com o mesmo comportamento fail-closed dos consumidores de #922. Em `QUESTION`, `AI_QUESTION_WEB_SEARCH_MODE=auto` oferece a ferramenta sem forçá-la; `disabled` (e o alias legado `off`) não envia a ferramenta, e valores desconhecidos falham fechados. Em `NUTRITION_SEARCH`, o resolvedor também valida a combinação provider + modelo + operações: Gemini 2.5 continua elegível para `QUESTION`, mas é rejeitado para Structured Output + Google Search na mesma chamada; apenas um Gemini 3 explicitamente aprovado pode executar essa combinação, e a #927 preservou os defaults por falta de comparação live suficiente. Fonte insuficiente, ferramenta não executada, citação sem suporte à evidência ou incompatibilidade de marca, produto, sabor, peso ou embalagem degrada para o fallback nutricional canônico local, sem probe, retry ou fallback externo oculto dentro da tentativa do executor. Variantes ou medidas presentes apenas no candidato são tratadas como ambiguidade, não como correspondência. JSON/payload inválido pode consumir retry/fallback operacional; `found=false` é resultado funcional e não provoca segunda consulta. `EMBEDDING` indisponível ou com espaço vetorial divergente degrada para busca textual/canônica; Gemini segue inelegível por não anunciar `embeddings`.

## Consumidor migrado em #924

`TRANSCRIPTION` usa `resolveCapabilityConfig` + `executeResolvedCapability`, preserva `openai` + `whisper-1` como baseline e aceita texto útil sem `segments`. Texto somente com pontuação ou composto integralmente por marcadores e mensagens auxiliares de silêncio/inaudibilidade, como orientação para tentar novamente, é `empty_output` recuperável e pode acionar retry/fallback; o benchmark usa o mesmo predicado. Conteúdo misto com fala acionável permanece válido. Validação de data URL/base64, MIME, tamanho, payload vazio e configuração ocorre antes do adapter. Retrys são sequenciais; fallback fica desabilitado por padrão e existe no máximo uma chamada posterior quando explicitamente habilitado e elegível.

A regressão do WhatsApp é comportamental: duas entregas do mesmo callback resultam em um único download, uma transcrição e uma mutação. O benchmark usa seis fixtures sintéticos, uma tentativa, sem fallback, execução sequencial e saída sanitizada. O manifesto vazio ou inválido falha antes da rede; taxas sem denominador são `0` e médias sem amostra são `null`, nunca `NaN`/`Infinity`.

Antes de promover modelo em produção, executar `pnpm agent:check`, `pnpm build`, o smoke controlado e o benchmark real descrito em `docs/benchmarks/transcription/results/README.md`. A comparação não altera o default automaticamente.

## Consumidor migrado em #925

`IMAGE_ANNOTATION` possui três modos especializados e independentes de `MEAL_VISION`:

- `local` é o default. Valida MIME/base64/tamanho, auto-orienta uma cópia, compõe SVG por Sharp e cria um PNG derivado com chave distinta, sem criar adapter ou chamada externa.
- `external` valida a foto antes da rede, resolve a capacidade específica e usa o executor comum. Cada tentativa contém exatamente uma operação de imagem; depois das tentativas primárias existe no máximo uma chamada de fallback, se explicitamente habilitada e elegível.
- `off` encerra sem derivado.

Falha externa só degrada para local com `AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=local`; essa transição é degradação funcional e não fallback de provider. Falhas de configuração, provider, renderização local, upload ou envio do derivado não bloqueiam resposta textual, confirmação nem persistência da refeição. O original nunca é sobrescrito ou removido, e cartão-resumo separado não pode ser usado para mascarar ausência de anotação.

O gate discriminante inclui: default local sem rede mesmo quando a visão usa outro provider; derivado separado com dimensões preservadas; input inválido rejeitado antes de Sharp/storage/provider; same-provider fallback único; cross-provider sem flag não cria adapter; logs e respostas sem foto, base64, URL, prompt, segredo ou erro bruto. Rollout e rollback ficam documentados em `docs/design-docs/image-annotation-capability.md`.

## Metadados opcionais do contexto profissional

A abertura do workspace profissional separa a consulta essencial de perfil, entitlement e autorização da leitura complementar do evento mais recente do histórico. A leitura complementar tem orçamento de 250 ms, cache curto e retry após TTL, mas uma query que excede o orçamento continua contabilizada até realmente terminar. O serviço limita globalmente essas operações pendentes a `min(4, connectionLimit - 1)`; quando o limite está ocupado, retorna **Temporariamente indisponível** sem iniciar outra query. Essa reserva impede que retries de metadados opcionais consumam todo o pool e preserva capacidade para revalidar acesso. **Não informado** permanece reservado para ausência confirmada de atividade.

## Observabilidade operacional de IA (#926)

Toda tentativa executada pelo mecanismo comum gera telemetria técnica depois da validação funcional da tentativa. O sink é best effort: falha de persistência do evento não muda sucesso, retry, fallback ou erro entregue ao consumidor.

- Eventos usam `eventType=ai.inference_call` no pipeline existente de `logInferenceEvent`; não há segunda persistência concorrente.
- O resultado normalizado distingue `success`, `timeout`, `rate_limit`, `external_error`, `safety_block`, `empty_output`, `invalid_json`, `invalid_payload` e `invalid_configuration`.
- As métricas distinguem primário, retry, fallback, escalonamento, same-provider, cross-provider e degradação local. O executor continua sequencial e limita a execução a no máximo um fallback.
- Ferramenta oferecida sem execução não recebe unidade faturável. Custo incompleto ou preço desconhecido permanece `null`.
- A correlação aceita somente escalares limitados e chaves de baixa cardinalidade. Prompt, conteúdo, mídia, URL, erro arbitrário e objeto de SDK são descartados.

Durante incidente, filtrar `ai.inference_call` por capacidade, resultado, provider/modelo efetivo, papel da chamada, tipo de fallback e versão do catálogo. Custo é estimativa operacional, não cobrança. O catálogo deve ser atualizado por nova versão/data, nunca por scraping em runtime.

Testes de regressão devem provar que a operação recebe provider/modelo corretos através da fronteira normalizada, que `raw` não chega ao resultado funcional, que uma tentativa produz uma chamada outbound e que falha do sink não altera a inferência.

## Guardrails de billing

- `BILLING_ACCESS_MODE` permanece `open_access` até aprovação explícita da migração comercial; em `enforced`, indisponibilidade da fonte falha fechada.
- Evento do provider é idempotente por `(provider, providerEventId)` e nunca depende do retorno do navegador para ativar acesso.
- Reserva de capacidade bloqueia a assinatura dentro da transação; concorrência pela última vaga deve produzir um vencedor e uma rejeição clara.
- Reserva, liberação e revogação são repetíveis sem duplicar vaga, entitlement ou auditoria.
- Falha após reserva comercial deve ser compensada; revogação iniciada pelo paciente não pode ser bloqueada por indisponibilidade comercial.
- Versões comerciais são imutáveis para contratos existentes: publicar uma nova versão encerra somente novas contratações na anterior; `billingSubscriptions.planId` não é migrado implicitamente.
- Seed de catálogo é idempotente e fail-closed diante de drift: reexecução equivalente é no-op, enquanto divergência em preço, capacidade, recursos, ciclo ou meios de pagamento interrompe a operação.
- Reserva de cupom bloqueia o usuário e a revisão ativa dentro da transação, conta `reserved` + `confirmed` em todas as revisões do mesmo código e usa `contractKey` único; concorrência pelo último uso produz um vencedor, e retry recupera a reserva histórica original mesmo depois de revisão ou desativação do cupom.
- Mutações administrativas do catálogo revalidam `users.role = admin` com `FOR UPDATE` dentro da transação. Perda de autorização antes do lock impede qualquer mutação/auditoria; depois do lock, mudança concorrente de papel aguarda o commit.
- O workflow `Billing persistence TiDB gate` valida migration, drift Drizzle, concorrência, idempotência, sanitização e integridade antes do merge.
