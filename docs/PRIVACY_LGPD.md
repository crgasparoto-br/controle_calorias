# Privacidade e LGPD

## Comunicação profissional

Mensagens de acompanhamento são dados pessoais potencialmente sensíveis. A finalidade é permitir orientação e acompanhamento individual autorizado. O conteúdo não pode ser enviado a analytics nem logs; eventos operacionais registram apenas estado, canal, identificadores internos e erro sanitizado. Revogação bloqueia novas leituras pelo profissional, sem apagar automaticamente o histórico auditável nem substituir o fluxo de exportação/exclusão do titular.

Solicitações profissionais por e-mail ou celular usam minimização antes do consentimento. O profissional recebe apenas um comprovante opaco `pending`, independentemente de a pessoa existir, não existir ou coincidir com a própria conta. Contato, nome, telefone, e-mail, `patientUserId`, objeto de paciente, erro de entrega e eventos internos de resolução não atravessam `requestAccess`, `myAccesses`, `portfolio` ou `history` enquanto não houver autorização aprovada. Busca identificável na carteira é restrita a vínculos aprovados.

Comprovantes são persistidos em `professionalHistoryEvents` sem contato nem motivo. Cada tentativa aceita gera um comprovante próprio, tanto para alvo resolvido quanto não resolvido, para que repetição e contagem não confirmem a existência da conta. A associação interna com uma autorização canônica serve somente para validar uma decisão do próprio paciente e para deixar de exibir os comprovantes quando o vínculo sai de `pending`; ela não é exposta ao profissional. Comprovantes sem vínculo resolvido expiram da carteira após trinta dias. Eles não constituem autorização, cadastro paralelo ou base para leitura de dados do titular.

Este projeto processa dados de saúde e hábitos alimentares. Trate toda mudança em IA, WhatsApp, mídia, logs, analytics, exportação, exclusão, acesso profissional e integrações de saúde como mudança sensível.

## Dados pessoais e sensíveis

| Categoria                     | Exemplos                                                                                                                                        | Onde aparece                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Identidade                    | Nome, e-mail, `openId`, telefone WhatsApp e nome exibido                                                                                        | `users`, `userProfiles`, `whatsappConnections`                                                                         |
| Saúde/nutrição                | Idade, altura, peso, objetivo, restrições, refeições, macros, hidratação e exercícios                                                           | `userProfiles`, `weightEntries`, `meals`, `mealItems`, `waterLogs`, `exercises`                                        |
| Conteúdo bruto                | Texto de refeição, transcrição, imagem, áudio, notas livres e mídia                                                                             | `mealMedia`, `mealInferences`, fluxos de IA e WhatsApp                                                                 |
| Contexto conversacional       | Mensagens sanitizadas, transcrições sanitizadas, referências opacas de mídia, resumos e vínculos de domínio                                     | `whatsappConversations`, `whatsappConversationMessages`, `whatsappConversationSummaries`, `whatsappMessageDomainLinks` |
| Integrações externas          | Tokens OAuth, identificadores externos, atividades importadas do Strava, distância, duração, elevação, frequência cardíaca, cadência e potência | `appSecrets`, módulos de integrações de saúde                                                                          |
| IA                            | Prompt, contexto nutricional, reasoning, confidence, inferências e logs                                                                         | `server/_core`, `server/modules/assistant`, `server/modules/meals`                                                     |
| Operação                      | Tokens, IDs de canal, URLs de mídia, detalhes técnicos e logs de erro                                                                           | `appSecrets`, logs operacionais e analytics                                                                            |
| Compartilhamento profissional | Solicitações, consentimento aprovado/revogado, comentários, sugestões, metas oficiais, justificativas e pedidos de revisão                      | módulo `professionals`                                                                                                 |

## Princípios

- Minimização: persistir apenas o necessário para o produto.
- Finalidade: documentar por que cada novo dado sensível é necessário.
- Transparência: exportação deve ser compreensível para o usuário.
- Segurança: logs, analytics e mensagens de erro devem ser sanitizados.
- Retenção: dados brutos de IA, mídia, logs, contexto conversacional e integrações externas devem ter retenção intencional, não acidental.
- Consentimento: fluxos de profissional, WhatsApp, IA multimodal e integrações externas devem respeitar autorização explícita ou ação consciente do usuário.
- Não enumeração: superfícies de convite não devem confirmar cadastro, elegibilidade ou identidade antes do consentimento por diferenças de payload, status público, metadados, totais, repetição ou consultas auxiliares.

## Regras práticas

- Não logar `sourceText`, `transcript`, `reasoning`, token, telefone completo, URL assinada, payload bruto de atividade externa ou objetos crus de saúde.
- Não enviar dados de saúde identificáveis para analytics.
- Usar `safeLogDetail` ou helper equivalente para detalhes operacionais.
- Sanitizar erros de IA, webhooks, storage, OAuth e integrações antes de persistir ou exibir.
- Ao adicionar integração externa, documentar dados enviados/recebidos, motivo, retenção e comportamento de exclusão.
- Tokens do Strava devem permanecer criptografados em `appSecrets`; logs de sincronização automática devem conter apenas contadores, status e mensagens sanitizadas.
- Atividades do Strava são importadas para exercícios para manter o diário do usuário atualizado sem sincronização manual.
- Métricas detalhadas do Strava, incluindo frequência cardíaca, cadência, potência, equipamento, visibilidade e contadores sociais, devem ser exibidas apenas para o usuário autenticado e não devem aparecer em logs ou analytics.
- O escopo `activity:read_all` deve ser usado apenas para permitir importação de atividades privadas ou Only Me quando o usuário reconectar e conceder esse acesso.
- Mídias salvas em qualquer provider devem usar chaves opacas, sem telefone, `userId`, `imageId`, `audioId` ou nome original no caminho persistido.
- URLs públicas devem ser usadas apenas para artefatos que precisam sair do backend, como a imagem anotada enviada pelo WhatsApp. Mídias originais e recebidas devem manter referência interna quando armazenadas pelo backend.
- Se um bucket tiver domínio público de leitura, trate a posse do caminho do objeto como acesso potencial à mídia. Não registre caminhos completos em logs desnecessários e configure lifecycle policy para limitar retenção.
- A exclusão de conta remove os vínculos e linhas principais do produto. Objetos externos exigem rotina operacional ou lifecycle policy até existir deleção automatizada por chave.
- Ao adicionar tabela/campo sensível, atualizar `docs/generated/db-schema.md`.
- Justificativas de metas profissionais e motivos de revisão são dados nutricionais sensíveis: permanecem no banco e nas telas autorizadas, não entram em logs, analytics nem na notificação ao paciente quando a justificativa for privada.
- Notificações de meta guardam somente estado operacional, tentativas e erro sanitizado; o conteúdo enviado é reconstruído a partir da versão canônica e não é duplicado na tabela de entrega.
- Eventos internos de comprovante de acesso não podem ser retornados por históricos públicos nem conter o contato solicitado.
- A resolução de comprovante em aprovação ou revogação deve validar que o usuário autenticado é o paciente dono da autorização; comprovantes apresentados por terceiros não podem revelar associação ou existência.
- O stream SSE de revogação profissional exige sessão autenticada e autorização vigente na abertura, isola conexões por profissional e paciente e transmite somente `patientId` e instante da revogação; nome, contato, conteúdo clínico, motivo e identificador da autorização não atravessam o stream.
- Rascunhos profissionais não salvos permanecem somente em memória e são isolados pelo identificador da autorização e do paciente. Revogação, perda do perfil profissional, encerramento da sessão ou desmontagem do shell removem esse conteúdo antes que outro contexto possa ser exibido.

## Contexto persistente do WhatsApp

- A chave idempotente usa o `message.id` da Meta somente para impedir duplicação; o payload bruto da Meta não é persistido como log operacional.
- Texto e transcrição passam pela política de sanitização antes de alimentar contexto ou resumo. A retenção de conteúdo bruto é separada da retenção sanitizada e da trilha de auditoria.
- Imagem e áudio são representados no contexto por chave opaca e MIME type; URL temporária, telefone e identificador externo da mídia não devem compor a chave persistida.
- Resumos guardam proveniência por intervalo de mensagens e nunca substituem os dados nutricionais atuais como fonte de verdade.
- Vínculos entre mensagem e refeição, item, água, peso ou exercício são auditáveis e não devem duplicar o registro de domínio.
- Os modos `legacy`, `write_only`, `shadow` e `persistent` registram somente contadores, origem escolhida, fluxo, truncamento e divergência booleana. O conteúdo comparado não entra na telemetria.
- Rollback desativa leitura persistente por fluxo e mantém escrita, schema, retenção e dados já gravados; não deve executar downgrade destrutivo.
- Limpeza do histórico conversacional não pode remover refeições, itens, água, peso, exercícios ou outros dados nutricionais.

## Billing e acesso comercial

Billing persiste somente dados comerciais necessários: produto/versão contratada, estado normalizado, período, identificadores externos do provider, origem do entitlement, capacidade, revisão de cupom aplicada e trilha administrativa. O titular da cobrança e o beneficiário do acesso são entidades distintas. Cobertura profissional não cria assinatura em nome do paciente e não substitui consentimento para acesso aos dados de saúde. Reservas de cupom guardam apenas usuário interno, versão comercial, chave idempotente da contratação e valores do desconto; não copiam dados nutricionais, mensagem, telefone ou payload de pagamento.

Payload bruto de pagamento não é persistido. O provider futuro deve normalizar o webhook e enviar apenas metadata allowlisted; cartão, CVV, token, segredo, endereço, e-mail, telefone ou objetos aninhados são descartados. Encerrar assinatura, cobertura ou override não apaga histórico nutricional ou clínico; exportação e exclusão seguem os contratos do titular e as obrigações legais aplicáveis à trilha comercial.

## Exportação e exclusão

A especificação funcional está em `docs/product-specs/privacy-export-deletion.md`.

O endpoint autenticado `nutrition.privacy.exportData` deve retornar os dados principais do próprio usuário em formato compreensível, incluindo conta/perfil, metas, refeições, exercícios, hidratação, peso, preferências, restrições e estado de canais quando aplicável.

O endpoint autenticado `nutrition.privacy.requestAccountDeletion` deve remover ou desvincular dados principais vinculados ao usuário, incluindo conta, perfil, refeições, itens, mídias, favoritos, inferências, hábitos, metas, água, exercícios, preferências, restrições, gamificação, vínculos WhatsApp, contexto conversacional e logs de inferência. Alimentos criados pelo usuário podem ser desvinculados quando a remoção direta causar conflito de integridade.

Backups, logs de infraestrutura fora do banco e arquivos externos em storage dependem de política operacional de retenção ou automação específica.

## IA e serviços externos

O assistente alimentar não deve enviar nome, e-mail ou identificador interno do usuário para o provedor de IA. Ainda assim, preferências, restrições alimentares, texto livre, foto, áudio ou transcrição podem conter dados sensíveis e devem ser tratados como conteúdo protegido.

Foto, áudio e transcrição podem envolver serviços externos de transcrição, visão ou LLM. Sempre que o fluxo usar mídia com IA, mantenha o comportamento documentado, evite retenção acidental e prefira URLs com expiração quando houver necessidade de acesso externo.

Quando uma imagem produzir marca/variante estruturada e o catálogo local não tiver referência exata, `NUTRITION_SEARCH` pode receber somente a descrição comercial necessária (produto, marca, variante e porção) para localizar uma fonte nutricional verificável. A pesquisa não recebe nome, telefone, identificador do usuário nem a foto novamente; rejeição de fonte e fallback não adicionam logs do texto consultado ou da evidência bruta.

### Transcrição de áudio e benchmark (#924)

A finalidade do envio de áudio é produzir texto para o fluxo solicitado pelo próprio usuário. O envio ocorre somente ao provider efetivamente resolvido para `TRANSCRIPTION`; o baseline permanece OpenAI + `whisper-1`. A configuração de visão, texto ou outra capacidade não autoriza envio de áudio.

- Áudio, prompt e texto transcrito não entram em diagnóstico, métricas de capacidade ou resultado do benchmark.
- O adapter pode manter o objeto nativo apenas dentro de `_core`; `raw` é removido antes do domínio.
- `language`, `duration`, `segments` e `usage` são opcionais. Ausência não deve gerar informação artificial nem ampliar retenção.
- Callback duplicado do WhatsApp é descartado antes de baixar ou reenviar mídia.
- Fallback é desabilitado por padrão. A #927 não aprovou envio de áudio a provider diferente; ele continua bloqueado em produção até adapter compatível, nova evidência, validação de privacidade e autorização operacional específicas.
- Os fixtures versionados são sintéticos e marcados `synthetic-only`. O harness recusa manifesto vazio ou fora dessa política.
- O JSON de resultado contém apenas métricas, modelos, ambiente, política, custos estimados, limitações e códigos sanitizados. Não contém áudio, referência externa, prompt nem texto retornado.
- A chave de API usada para executar o benchmark fica somente no ambiente autorizado e não pode ser versionada ou copiada para comentário, artefato ou log.

A retenção funcional de mídia/conversa já prevista pelo produto é diferente da telemetria de IA: não se deve usar o benchmark ou diagnóstico operacional como nova base de retenção de áudio/transcrição.

### Anotação derivada da foto (#925)

A finalidade do modo local é produzir um auxílio visual determinístico sobre uma cópia da foto enviada pelo próprio usuário. Esse modo é o padrão, não usa IA generativa e não envia foto, prompt ou dados nutricionais a provider de imagem. A seleção de `MEAL_VISION`, texto ou outro provider não autoriza nem redireciona a anotação.

O modo `external` é tratamento adicional e exige configuração explícita e executável de `AI_IMAGE_ANNOTATION_*`. Ele constitui novo compartilhamento da foto com o provider específico da capacidade. Fallback externo é desabilitado por padrão; a #927 preservou o modo local, e cross-provider permanece bloqueado em produção até análise de transferência internacional, nova evidência, revisão LGPD e autorização operacional específicas. A degradação local configurada após falha externa não é fallback de provider e não cria outro envio.

A foto original permanece inalterada. Original e derivado usam buffers e chaves de storage distintos, devem ser exportados e excluídos de forma independente e seguem a política de retenção aplicável às mídias da refeição. Falha de geração, armazenamento ou envio do derivado não remove o original, não altera a resposta textual e não impede a persistência da refeição. Cartão-resumo sem foto original é artefato separado e não pode ser descrito como anotação.

Diagnósticos, logs e telemetria não podem conter foto, base64, URL assinada, prompt, texto nutricional, resposta bruta do provider, segredo ou mensagem de SDK. Entradas base64 são rejeitadas por tamanho antes da alocação do buffer decodificado, reduzindo exposição a pressão de memória sem ampliar retenção.

### Segundo envio a provider (fallback) e diagnósticos sanitizados (#921)

A fundação multi-provider por capacidade (`server/_core/ai/`) permite no máximo um segundo envio por fallback e aplica estes limites:

- Fallback é desabilitado por padrão e nunca encadeia um terceiro provider.
- Enviar dados a provider diferente exige `AI_<CAPABILITY>_CROSS_PROVIDER_FALLBACK_ENABLED=true` para aquela capacidade fora de produção. Em `NODE_ENV=production`, nenhum payload, prompt ou mídia é enviado ao segundo provider: a #927 não aprovou cross-provider, e uma liberação futura exige nova evidência, revisão de privacidade/LGPD e autorização operacional por capacidade, mesmo quando a flag estiver `true`.
- Cada callback recebe `AbortSignal`. Após timeout, a execução aguarda a chamada anterior encerrar antes de iniciar retry ou fallback; se o provider não reconhecer o cancelamento dentro da janela de segurança, a execução termina em modo fail-closed, sem segundo envio.
- `OPENAI_BASE_URL` não vazio é considerado endpoint compatível. Somente operações listadas em `AI_OPENAI_COMPATIBLE_OPERATIONS` ficam elegíveis, evitando assumir suporte a dados sensíveis como imagem, áudio, pesquisa ou embeddings.
- Diagnósticos contêm apenas identificadores e razões sanitizadas, nunca prompt, payload, imagem, áudio ou segredo.
- Degradação funcional local, como busca textual sem embeddings ou anotação local, não é fallback externo e não cria um segundo envio.
- `MEAL_TEXT`, `MEAL_VISION` e `WHATSAPP_INTENT` usam o resolvedor desde #922; `QUESTION`, `NUTRITION_SEARCH` e `EMBEDDING` usam o mesmo resolvedor desde #923; `TRANSCRIPTION` usa o resolvedor desde #924. `FOOD_CLASSIFICATION` permanece sem consumidor externo; a NOVA viaja somente na mesma chamada de refeição.

## Riscos conhecidos e cuidados recorrentes

- Novos `console.*` ou logs de objetos crus podem vazar dados sensíveis se não forem revisados.
- Dados de saúde em tabelas principais dependem da criptografia do banco/disco gerenciado; o código atual não aplica criptografia de campo ampla.
- Mídias em storage externo podem exigir lifecycle policy ou rotina de deleção por chave para alinhamento completo com exclusão de conta.
- `mealInferences.sourceText`, transcrições e contexto conversacional armazenam conteúdo alimentar sensível; alterações nessa área devem avaliar minimização e retenção curta.
- Integrações de saúde devem manter rastreabilidade externa suficiente para evitar duplicidade sem expor identificadores sensíveis em logs.
- Convites profissionais podem voltar a enumerar contas se uma nova superfície expuser diferenças entre alvo existente e inexistente; toda rota auxiliar deve reutilizar a política pública canônica.

## Checklist para PRs sensíveis

- [ ] O dado coletado é necessário?
- [ ] Existe base clara no produto para uso do dado?
- [ ] Exportação e exclusão continuam coerentes?
- [ ] Logs e analytics foram sanitizados?
- [ ] Dados de IA, mídia, WhatsApp e integrações externas têm retenção intencional?
- [ ] Convites evitam enumeração antes do consentimento em todas as superfícies públicas, inclusive totais e repetição?
- [ ] Documentação canônica foi atualizada?

### Aplicação em refeição e intenção (#922)

Cada capacidade possui opt-in próprio de fallback. Habilitar fallback em `MEAL_TEXT` não habilita `MEAL_VISION` nem `WHATSAPP_INTENT`. Resultado funcional, inclusive `items: []`, não gera segundo envio. Respostas nativas `raw` permanecem dentro da camada `_core`; serviços de refeição e WhatsApp recebem somente texto/identificador e usage numérico sanitizado. `FOOD_CLASSIFICATION` não envia dados externamente nesta fase.

### Aplicação em pergunta, pesquisa nutricional e embedding (#923)

O mesmo isolamento por capacidade se aplica a `QUESTION`, `NUTRITION_SEARCH` e `EMBEDDING`: habilitar fallback em uma delas não habilita as demais. `QUESTION` e `NUTRITION_SEARCH` recebem respostas via `_core/ai/domainTextResponse.ts`, que remove `raw` do SDK antes de entregar dados ao domínio (assistente de perguntas do WhatsApp e busca nutricional do catálogo). `EMBEDDING` preserva `text-embedding-3-small` da OpenAI como default; como Gemini não anuncia a operação `embeddings`, cross-provider fallback para `EMBEDDING` fica indisponível hoje mesmo com opt-in explícito, sem exigir bloqueio manual adicional.

### Telemetria de IA e custo estimado (#926)

A finalidade de `ai.inference_call` é confiabilidade operacional: medir tentativas, latência, resultado, usage, ferramenta executada, política de fallback e custo estimado por capacidade. O evento não é uma nova cópia do conteúdo tratado pela IA.

- Não persistir prompt, refeição, pergunta, transcrição, foto, áudio, base64, URL assinada, resposta, reasoning textual, headers, segredo, mensagem de SDK ou `raw`.
- A correlação é técnica, limitada a oito escalares sanitizados e sem chaves relacionadas a conteúdo, mídia, erro, autenticação, token, cookie, header ou URL.
- Provider/modelo e tipo de fallback podem ser registrados para demonstrar a política aplicada, sem registrar o conteúdo de eventual segundo envio.
- A implementação reutiliza os logs de inferência existentes; portanto, audiência, retenção, exportação e exclusão seguem o contrato desses logs. A exclusão de conta já inclui logs de inferência vinculados ao usuário quando aplicável.
- Não foi criada tabela, router ou retenção nova em #926. Qualquer persistência futura específica para telemetria exige finalidade, índice, volume, retenção, exportação e exclusão documentados antes do rollout.
- `estimatedCostUsd` é estimativa operacional baseada em catálogo versionado e pode ser `null`; não representa cobrança real, fatura nem decisão automática de tratamento.
