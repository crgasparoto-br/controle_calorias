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
- Convergência da resolução alimentar entre canais durante a migração do Food Intelligence V2, sem reabrir fatos estruturados nem criar owners paralelos.
- Confirmação de rascunho de refeição.
- Relatórios e dashboard.
- Integrações de saúde, incluindo OAuth, sincronização automática do Strava e exibição de métricas detalhadas de atividades.
- WhatsApp inbound e outbound.
- Exportação e exclusão de dados.
- Migrações e integridade referencial.
- Elegibilidade, capacidade profissional e eventos idempotentes de billing.
- Arquitetura multi-provider de IA por capacidade, incluindo rollout, fallback e aposentadoria dos seletores globais conforme `ARCHITECTURE.md` e `docs/runbooks/ai-legacy-config-removal-960.md`.

## Gates recomendados

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```


Para mudanças de resolução alimentar, catálogo, memória, rótulo ou multimodalidade, ler também `docs/design-docs/adr-food-intelligence-resolver-v2.md`. Enquanto o ADR estiver em migração, regressões devem provar o comportamento no entrypoint público e distinguir o baseline atual da arquitetura alvo; mocks não podem substituir a própria decisão alimentar que o teste pretende validar.

### Preparação D1 de entrypoints multimodais (#1308)

O schema compartilhado `shared/foodD1WebDraft.ts` reconhece os rascunhos independentes `plate_image` e `packaging`, tanto no servidor quanto na tela, mas rejeita `nutrition_label` e `continuation` sem item físico vinculado. A rota `nutrition.meals.processDraft` passa a oferecer integração técnica de **foto de prato** e **frente de embalagem** em V2 quando o usuário seleciona explicitamente o tipo de foto e as flags `plate_image`/`packaging` autorizam o canal; inputs mistos exigem também o seletor `multimodal`. A capacidade comum `MEAL_VISION` extrai somente superfícies visuais, sem resolver entidade alimentar ou produzir nutrição. Uma imagem sem alimento pode produzir lista vazia, obrigatoriamente rejeitada antes de criar rascunho; quantidade visual ausente pode enriquecer a quantidade explícita do texto sem gerar segunda porção, ao passo que fatos explícitos contraditórios bloqueiam a operação. A LCL observa imagem com proveniência `vision` (prato) ou `ocr` (frente da embalagem), e o resolvedor V2 realiza a decisão completa. Mídia inválida ou sem evidência visual, tipo de foto ausente, e gates externos não aprovados bloqueiam sem fallback V1. A fonte de cada observação visual carrega o SHA-256 dos bytes de imagem e o índice da região extraída, sem armazenar os bytes, o nome de arquivo nem URL da mídia no rascunho. O papel visual selecionado integra a identidade de operação (hash de escopo/trace): o mesmo upload reinterpretado como outro tipo de foto sob a mesma chave é rejeitado, mesmo quando ambos os envios se apresentam como `multimodal`. Rótulo nutricional posterior continua sem autorização nesse fluxo: exige continuidade estruturada vinculada a item existente. Essa integração web não migra os webhooks WhatsApp nem prova E2E ou Gate A real.


No rascunho web D1 com texto e transcrição, observações com atributos materiais equivalentes são vinculadas por ocorrência, mantendo as âncoras e origens independentes de evidência em uma única observação `multimodal` do resolvedor canônico. Ocorrências repetidas dentro de um canal não são deduplicadas; evidências de alimentos distintos continuam separadas; conflito material entre canais para o mesmo alimento bloqueia o rascunho antes de qualquer commit. O comportamento permanece inacessível sem Gate A e seleção D1.


O contrato de entrada exige um autorizador de evidência do canal e um autorizador de propriedade do item físico antes de processar texto/transcrição/OCR ou retomar edição/rótulo. Ausência ou falha de qualquer prova exigida bloqueia o processamento. Rótulo sem nova evidência nutricional verificada ou com alteração de identidade é explicitamente adiado; não reutilizar macros antigos como se o novo rótulo tivesse sido aplicado. O roteamento V2 compara o SHA da aprovação independente ao material do build confiável (`expectedAuditedBaseSha`); o ambiente, o usuário e uma string de status não são prova suficiente.

O componente V2 `entrypointMigration.ts` é, neste recorte, um plano de decisões **somente leitura**, sem chamada à persistência de refeições; `registeredCount=0` e `committed=false` são invariantes, inclusive quando um dos itens está resolvido. O contrato de continuidade exige observação e decisão estruturadas e proprietário autenticado: item já persistido requer ID físico; irmão originalmente adiado e ainda sem item físico requer decisão anterior autorizada, revisão incrementada e ID de observação fixado no manifesto transacional da operação; rótulo não pode criar outro registro por reprocessamento de texto. `entrypointRouteRepository.ts` implementa o binding transacional e compartilhado de versão, policy, entrypoint e resolvedor; o schema usa chave única por usuário/operação e fixa o hash da operação (traceId, destino, data, timezone e canal), impedindo que a mesma chave retorne a outra refeição. O simulador V2 não grava refeições nem bindings; quando Gate A não está disponível, falha fechado. `entrypointPersistenceRepository.ts` prepara escrita nativa V2 com recibos por observação e lock da operação, e agora possui cobertura sintética transacional no TiDB isolado (migração, efeitos, replay, edição, concorrência, revogação e finalização de irmão previamente adiado). O manifesto imutável de observações é fixado na primeira transação sob lock; retries com novas observações não pertencentes à operação são rejeitados sem escrita. Antes dos efeitos, a transação bloqueia e revalida perfil, variante, escopo/owner e status da família alimentar, vínculo com a fonte (quando existente) e licença vigente: uma variante tornada estrangeira ou família aposentada não pode ser gravada com decisão antiga. Na edição, no rótulo posterior e na continuidade de item físico, o registro de destino precisa ter o mesmo proprietário, a mesma refeição e a mesma data **local** da operação fixada, usando o timezone do envelope: não basta ter um item ID válido do mesmo usuário, nem é necessário coincidir o horário exato de duas interações no mesmo dia. O gate TiDB sintético cobre destinos e datas divergentes (rejeição sem item nem recibo alterado) e edição posterior válida no mesmo dia. A ligação de escrita nativa aos contratos públicos está parcial (adição manual, edição pontual de item físico V2 e preparação de registro confirmado WhatsApp por texto/transcrição). Foto e embalagem já possuem ponte web de rascunho gated, mas a análise de foto separada, a mídia WhatsApp, o rótulo posterior, a continuidade pública e a homologação com dados reais permanecem pendentes. O fluxo web de revisão e confirmação possui testes de serviço e roteiro TiDB em processo separado para replay após restart, ainda **não executados no HEAD exato**. A migração SQL `0058_food_d1_web_drafts.sql` é aditiva e deve passar no teste TiDB tanto no upgrade quanto no rollback. A ponte WhatsApp exige origem autenticada da mensagem, operação alimentar canônica explícita, ID externo estável, autorização independente e consulta de pendência durável; ausência de qualquer um desses requisitos bloqueia a migração. É proibido substituir isso por cache de processo, recomputar o owner a cada retry ou reprocessar dados V1 como entrada factual V2.

`FOOD_V2_D1_ENABLED` permanece OFF por padrão; em produção `FOOD_V2_D1_ENTRYPOINTS` também precisa selecionar explicitamente os entrypoints D1 autorizados, sem nomes desconhecidos/duplicados. A ausência da seleção nunca abre V2. As pontes públicas preparatórias incluem o simulador WhatsApp autenticado (somente leitura), a adição manual em `nutrition.meals.createManual`, a edição pontual em `nutrition.meals.updateItem` e o registro confirmado WhatsApp (texto e áudio transcrito) por `publicWhatsAppRegistration.ts`, invocado pelo serviço e webhook autenticados. Toda escrita D1 selecionada exige Gate A e rollout independentes vinculados ao SHA em vez de confiar no cliente ou numa flag isolada. **O provedor produtivo de aprovação continua indisponível até #1335**; portanto nenhuma dessas pontes autoriza escrita real ou ativação da V2 nesta etapa. Ausência/revogação de gates impede V2. O simulador selecionado rejeita respostas a pendências conversacionais (`pendingContextKind`) antes de consultar Gate A ou alimentar o resolvedor: enquanto não houver continuidade V2 autorizada e vinculada ao estado anterior, uma resposta como `50 g` não pode virar outra observação alimentar. A ponte pública também preserva pendências de seleção/confirmação conhecidas pelo contexto conversacional do servidor, mesmo quando o request omite `pendingContextKind`; isso não substitui a migração da pendência durável e da continuidade pública, ainda pendentes da Fase D. No caminho selecionado, após a aprovação versionada e antes da resolução, o simulador também consulta pendências WhatsApp ativas no banco do proprietário; após restart, uma pendência durável bloqueia o V2 mesmo sem contexto conversacional em memória. Indisponibilidade dessa consulta bloqueia a simulação em vez de presumir que não existem pendências. O `traceId` do simulador é derivado da chave opaca idempotente para que dois replays com o mesmo ID externo não gerem traços divergentes; nenhuma mensagem é incluída na chave ou no trace. No caminho V2 selecionado, `messageId` externo ausente ou vazio é rejeitado: gerar um nonce aleatório violaria a continuidade idempotente após reinício. Com a flag OFF, o fluxo V1 continua aceitando o contrato público atual. Com a flag desativada, o fluxo V1 permanece inalterado. Ao desligar a flag durante uma operação V2, a retomada é bloqueada explicitamente, sem replay da V1. Também em `nutrition.meals.processDraft`, o ID de submissão web é consultado no binding durável **antes de retornar ao fluxo V1**: operação já fixada na V2 rejeita rollback ou troca de modalidade, enquanto uma chave nova sem binding preserva a rota V1; falha ao consultar a rota não presume ausência de pin. A integração dos demais entrypoints públicos, a validação E2E TiDB pelos endpoints efetivos (incluindo restart, concorrência, rótulo e LGPD) e os gates reais pós-deploy continuam bloqueadores para concluir a issue #1308 e liberar homologação.

Antes da migração pública completa, `publicUnmigratedEntrypoints.ts` protege seleções D1 ainda não implementadas: `nutrition.meals.processDraft` encaminha texto/áudio e, com papel visual explícito, foto de prato e frente de embalagem para o rascunho V2 gated; rótulo posterior continua bloqueado até existir alvo físico verificado e continuidade estruturada; `nutrition.foodPhotoAnalysis.analyze` bloqueia imagem de prato selecionada; o registro confirmado WhatsApp encaminha texto/transcrição de nova operação com modalidade provada pelo lifecycle ao writer V2, ou falha fechado antes do pré-processamento V1 quando selecionado sem autorização; pendências V1 pré-existentes conservam o handler original. Os dois webhooks reais (convencional e imagem anotada) também bloqueiam os caminhos de inferência alimentar quando a mídia for selecionada para V2: áudio exige `audio_transcript`; imagem bloqueia `plate_image`, `packaging` ou `nutrition_label` sem tentar classificar a origem por legenda. No webhook convencional, a guarda está após o roteamento não alimentar e antes de `processMealInputWithPartialFailures`; no webhook de imagem anotada, imediatamente antes do resolvedor visual V1. Uma imagem no rascunho web sem papel visual explícito não autoriza classificação; a escolha autenticada no formulário distingue prato/embalagem, mas não converte rótulo posterior em nova refeição. Nos webhooks de mídia ainda não migrados, a guarda impede qualquer classificação baseada somente na legenda. Todos os controles ficam inertes com flags OFF e não resolvem nem persistem alimentos. São guardas de segurança contra fallback V1 silencioso, **não** integração E2E V2. Continuação de pendência V1 já reconhecida pelo contexto do servidor (por exemplo, segmentos estruturados de clarificação ou solicitação ativa de rótulo vinculada ao usuário) continua no handler legado, sem troca implícita de resolver ao variar a flag; a exceção não vale para uma operação nova sem pendência. Ainda faltam rótulo posterior e continuidade V2 durável, análise de foto pela rota pública separada, mídia nos webhooks WhatsApp, validação E2E da nova confirmação web por imagem, migração integral dos leitores e controles adversariais completos. Imagem de prato e frente de embalagem possuem ponte web gated, não cutover produtivo. A confirmação web de um item de voz ou imagem corrigido por texto conserva o registro não verificado da origem anterior com IDs de evidência distintos, sem transformar a correção em uma observação exclusivamente textual; o resolvedor V2 continua responsável por reconciliar as alegações. A integração WhatsApp é técnica, ainda inativa no runtime produtivo sem Gate A: a fonte do tipo de mensagem é o lifecycle autenticado; um ID externo ausente não cria nonce nem recibo. O contrato operacional usa o parser de destino/data já existente, mas identidade alimentar, quantidade e nutrição são decididas apenas pelo resolvedor V2. O teste TiDB isolado injeta uma decisão sintética, valida transação, recibo, leitura pública e replay (inclusive texto adulterado ou modalidade trocada); não valida a acurácia real do resolvedor nem substitui #1335.

A adição manual V2 produz observações não verificadas a partir de nome, quantidade e unidade do formulário, sem utilizar calorias ou macronutrientes fornecidos pelo usuário como evidência. Requer `d1OperationId` estável por envio/retry e rejeita lotes com irmãos adiados antes de qualquer escrita, porque o DTO público V1 não representaria essa pendência. A edição pontual V2 exige item físico previamente associado a snapshot V2 verificável, mesmo proprietário, refeição e data; o usuário não pode deslocar o item para outra refeição pelo adapter de edição nativo. Itens históricos V1 continuam no caminho legado, sem conversão de `semanticContract`. Os consumidores web retêm o mesmo ID enquanto repetem o mesmo envio e geram um novo ID ao alterar o payload. Mesmo com a seleção D1 desligada, uma adição manual com ID de operação explícito consulta o vínculo transacional antes da escrita legada: a chave possui um owner V1 persistente criado por upsert transacional mesmo antes de ativar a V2; se já estiver fixada em V2, rollback bloqueia a gravação V1. Conflito de usuário, destino, data ou conteúdo nutricional/item sob a mesma chave e falha no banco também bloqueiam, em vez de reusar a operação silenciosamente. Se o rollout V2 estiver devidamente aprovado, uma chave previamente fixada em V1 continua no caminho V1, sem reinferência pela V2. A criação manual com ID estável também persiste um recibo V1 por operação na **mesma transação** que cria a refeição e seus itens; reenvios após restart ou concorrentes leem o recibo sob lock e retornam a refeição confirmada, sem duplicar a mutação ou os hábitos. Os scripts TiDB sintéticos D1 exercitam esse contrato pelo serviço público `createManualMeal` e repetem um envio V1 em um segundo processo Node real, além dos testes de unidade com conflitos e controle negativo. O caminho de memória sem banco permanece restrito às chamadas V1 legadas sem ID de operação; para as novas chamadas com ID, indisponibilidade de transação falha fechada. O deploy técnico que introduz esses clientes exige a migração D1 de rotas instalada. São preparações técnicas sob flags e gates, não habilitação produtiva, nem prova de equivalência multimodal ou confirmação web em duas fases.

No caminho de medidas caseiras para leitura histórica, a presença de snapshot físico V2 verificado exige `historicalRef=variant:<id>` imutável e não projeta `foodCatalogId` legado; marcador V2 sem referência de variante falha fechado. Regressões separadas preservam itens V1 e refutam remapeamento silencioso de duas variantes homônimas.

O leitor público de refeições agora reconhece exclusivamente snapshots V2 verificados e vinculados ao item físico para expor a referência histórica da variante, sem consultar o catálogo corrente. Registros V1 e notas legadas não ganham os novos campos; classificação ausente em V2 continua desconhecida. Os indicadores de qualidade passam a usar somente classificação persistida para esses itens V2, mesmo quando o relatório geral ainda está em modo de catálogo V1; identidade histórica sem classificação continua explicitamente desconhecida. O planejamento de busca dos relatórios ignora itens com snapshot V2 físico verificado: não solicita nomes nem IDs ao catálogo mutável para essas linhas; refeições mistas continuam consultando o catálogo apenas para itens V1. Os diagnósticos e a listagem das categorias preservam `historicalRef` quando existente, expondo qual variante histórica originou cada grupo sem alterar o DTO legado quando o campo não existe. Essas garantias são cobertas por controles positivos (V2, V1) e negativos (homônimos V2, período misto). A migração restante dos entrypoints públicos continua dependente das provas e gates da Fase D.

Durante essa transição, a escrita legada V1 deve falhar antes de qualquer mutação ao tentar substituir, editar ou mover um item com marcador físico V2 `format=food-v2` (inclusive marcador malformado). O DTO V1 não possui autorização nem dados estruturados suficientes para regravar a decisão nutricional versionada; a edição pontual do item exige autorização de Gate A/rollout e o adapter V2 nativo preparado nesta PR; operações fora de seu escopo permanecem bloqueadas. A recusa ocorre sob lock transacional, antes de modificar status, nutrientes, snapshot ou criar refeição destino. Registros V1 ordinários permanecem editáveis. A duplicação de refeições e o salvamento de favoritos também recusam projeções V2 verificadas antes da criação de uma nova refeição ou favorito, pois o DTO legado não contém o snapshot físico completo para essa operação. Controles negativos e testes diretos do repositório: `server/modules/meals/foodV2Snapshot.test.ts`. Esta proteção e as pontes de adição/edição não concluem a Fase D nem habilitam cutover.

### Contratos operacionais do Food Intelligence V2

Além da convergência funcional, o V2 deve ser validado como sistema operacionalmente seguro:

- cada resolução opera sob orçamento explícito de latência, tentativas e custo; chamadas externas redundantes são defeito;
- retries e múltiplas instâncias devem permanecer idempotentes para variantes, perfis, aliases, review cases e mutações de refeição;
- indisponibilidade de IA/OCR/pesquisa externa aplica modo degradado determinístico, sem transformar falha externa em fallback nutricional oculto;
- telemetria sanitizada deve medir status da resolução, clarificação, fallback, divergência, latência, chamadas externas e custo estimado;
- shadow mode e canário só avançam quando Golden Food Corpus, qualidade, latência, custo, integridade e privacidade permanecem dentro dos limites aprovados;
- rollback deve ser não destrutivo: restaurar leitura/decisão anterior sem apagar evidências e dados V2 já persistidos;
- continuação de proposta pendente revalida a elegibilidade temporal de perfil, porções e autorizações das fontes, inclusive quando somente o relógio avançou; snapshot sem metadado de validade exige reconsulta e snapshot confirmado permanece imutável;
- regressões do núcleo C2 devem cobrir resposta apenas com quantidade, conflitos de identidade em todo o envelope de evidências, vencimento exato e preservação dos fatos ainda sustentados;
- proveniência de macros deve apontar ao perfil governado, e classificação alimentar com afirmações verificadas contraditórias deve exigir clarificação;
- nenhuma continuação pode importar evidência de outra conta: snapshots V2 novos incluem proprietário, snapshots antigos exigem prova de escopo e contextos anônimos não reutilizam decisões;
- correções de identidade em turnos posteriores substituem somente alegações textuais anteriores do próprio usuário, quando a nova evidência verificada está ancorada na superfície atual e concorda com o campo estruturado; evidências independentes (fonte governada, rótulo, barcode) continuam em conflito explícito quando divergirem. Snapshots anteriores são imutáveis; confirmações repetidas devem convergir sem depender da reutilização de IDs de evidência;
- IDs de evidência não conferem autoridade entre turnos: reutilização do mesmo ID com conteúdo/proveniência diferente exige nova identidade local e preserva o fato anterior, inclusive links de hipóteses. Quantidade confirmada em `grams` ou `milliliters` deve ser comparada à nova alegação após conversão física comprovada (ex.: `0,1 kg = 100 g`), mesmo sem `value/unit` no snapshot; diferenças impedem `propose` e exigem `clarify`;
- o gate arquitetural inspeciona conhecimento alimentar literal mesmo sob anotações ou aliases de tipos de decisão; controles estruturais benignos continuam aceitos sem isenção pelo nome textual do tipo.

Os valores numéricos de SLO, timeout, orçamento e limites de rollout são definidos no ADR a partir de baseline e shadow mode, não por constante arbitrária isolada.

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
- Para IA multi-provider, testes devem provar pareamento provider/modelo por capacidade, rejeição fail-closed, timeout/retry/fallback limitados e ausência de efeito dos seletores globais aposentados.
- Para visual auxiliar opcional, testes devem provar que falhas do provider não bloqueiam análise nem confirmação da refeição.
- Para produto industrializado com marca reconhecida, miss do catálogo local pode produzir no máximo uma pesquisa nutricional específica por item antes do fallback. Fonte de outra marca, variante ou porção deve ser rejeitada sem segunda consulta oculta; falha/indisponibilidade preserva a identidade comercial e mantém a clarificação canônica quando marca/variante não estiver comprovada, sem liberar referência heurística como composição do produto.
- O caminho contável deve registrar, de forma sanitizada, se a decisão terminou por configuração indisponível, falha operacional, `found=false`, incompatibilidade de identidade/variante/porção, grounding insuficiente/conflitante ou aceite. Os guards persistidos distinguem `productIdentity`, `brandIdentity`, `variant`, `portion`, `numericGrounding` e `sourceGrounding`. O `traceId` é opaco, e o detalhe não contém nome, query, porção textual, URL, evidência, resposta ou erro bruto. Quando a pesquisa de identidade já foi executada, falta de relação física comprovada permanece fail-closed sem nova chamada a `NUTRITION_SEARCH`.
- Para `IMAGE_ANNOTATION`, testes devem distinguir `local`, `external` e `off`, provar ausência de rede no default local, preservar os bytes originais, limitar uma chamada por tentativa e manter falhas locais/externas não bloqueantes.

## Governança de uso e custo

- Toda tentativa potencialmente faturável de provider deve reservar uma posição idempotente durável antes do efeito externo. Falha na reserva impede a chamada; falha na finalização preserva a posição pendente para reconciliação e nunca repete o efeito.
- Fatos econômicos estimados e efetivos permanecem separados. O efetivo referencia e substitui explicitamente a estimativa compatível; receita e KPIs consideram apenas a versão ativa.
- Reuso conflitante de chave idempotente falha fechado. Retry equivalente é um no-op verificável pelo fingerprint normalizado.
- Analytics percorre fatos por paginação interna e expõe cobertura, fonte, intervalo disponível e retenção. Um limite interno de lote nunca pode ser apresentado como histórico completo.
- Limitações, extensões, recursos e encerramentos usam transações e invariantes de banco. O job de retenção só remove casos terminais anteriores a cinco anos e respeita legal hold ativo.

## Pendências multietapas do WhatsApp

- Persistir a operação pendente antes de emitir pergunta, botão ou solicitação cuja resposta dependa do contexto salvo.
- Memória do processo pode apoiar somente testes ou desenvolvimento não produtivo explicitamente habilitado; nunca representa durabilidade entre reinícios ou instâncias.
- Em produção, banco ausente, conexão indisponível ou erro do provider deve fazer criação, leitura, claim e transições falharem fechado, com diagnóstico sanitizado.
- Falha de persistência não pode produzir pergunta órfã, mutação de domínio, evento de sucesso nem resposta funcional que pressuponha estado recuperável.
- Testes discriminantes devem chamar o repository real em ambiente de produção equivalente e cobrir dependência indisponível, reinício e segunda instância quando a continuidade exigir durabilidade.
- Fotos de rótulo que complementam item nutricional provisório devem persistir correlação e, quando necessário, a própria evidência analisada antes de perguntar novamente. Sem essa persistência o outbound não pode convidar o usuário a enviar rótulo. O item original permanece a fonte de verdade para identidade comercial; visão divergente não pode trocar produto, marca ou variante sem confirmação da dimensão realmente conflitante, e marca coincidente isoladamente não valida outro produto da mesma marca.
- A aplicação do rótulo reivindica a pending operation exata com versionamento antes da mutação e revalida o item persistido. Retry, reentrega, concorrência, usuário diferente, fonte expirada ou estado já atualizado devem resultar em no máximo uma mutação.
- Se a mutação falhar depois do claim, a recuperação deve preservar a evidência em nova continuação segura ou responder sem afirmar sucesso; não é permitido criar nova refeição, repetir automaticamente o efeito ou promover candidato global.
- Falha de inferência em adição canônica é sempre anterior à mutação: o usuário recebe erro recuperável que não afirma registro, e nenhuma exceção crua pode escapar para o webhook.
- Um termo de catálogo inteiro nunca é ruído: nenhuma evidência heurística pode anulá-lo. Frases que apenas contêm um alimento seguem dependendo da evidência negativa.
- A vírgula entre dígitos é separador decimal em toda segmentação de texto de refeição.
- Falha de inferência (`MealInferenceError`) no fluxo textual entrega clarificação controlada antes de marcar a mensagem como processada; erro que não é de domínio continua propagando para preservar o contrato de posse e reinício. Quando a resposta controlada também não é entregue, o erro original continua propagando.

## Incidentes comuns a prevenir

- Migração não aplicada em produção.
- Divergência entre rascunho e confirmação.
- Log de dados sensíveis.
- Falha silenciosa no envio WhatsApp.
- Mensagem textual encerrada sem nenhuma resposta ao usuário depois de falha inesperada do pipeline (claim fechado como processado e retry do provedor deduplicado como reentrega).
- Falha do motor nutricional na adição canônica virando exceção crua em vez de resposta controlada.
- Alimento real do catálogo descartado como ruído não alimentar por evidência heurística (modelo lexical de n-gramas ou stem de material com match por prefixo), zerando a refeição.
- Quantidade com vírgula decimal segmentada como dois itens, registrando o próprio número como alimento.
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
- Alias global/modelo aposentado voltando a influenciar provider, modelo, timeout ou tentativas de uma capacidade.

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

## Guardrails para IA por capacidade

- Não misturar migração de autenticação com mudanças de IA.
- Provider, modelo, timeout, tentativas e fallback devem ser resolvidos por `AI_<CAPABILITY>_*` e defaults versionados; não reintroduzir seletores globais/modelos aposentados na #960.
- `OPENAI_API_KEY`, `GEMINI_API_KEY` e `OPENAI_BASE_URL` continuam sendo credencial/endpoint de adapter e não fazem parte da aposentadoria de seletores.
- Manter fallback seguro ou erro controlado quando o provider efetivo estiver indisponível.
- Confirmação de refeição não deve depender de chamada externa.
- Validar saída de IA com Zod antes de retornar ou persistir.
- Recalcular totais nutricionais no backend a partir dos itens validados.
- Falha de visual auxiliar deve degradar para ausência/fallback local de imagem, nunca para falha de refeição.
- Falha de leitura da preferência de imagem anotada deve degradar para o estado desabilitado, com diagnóstico sanitizado e sem impedir análise, persistência da foto original, registro ou resposta textual.
- Rodar smoke test web e WhatsApp antes de ativar mudança operacional de provider/modelo em produção.

## Fundação multi-provider de IA por capacidade (#921/#960)

`server/_core/ai/` define o registro de capacidades, a matriz de suporte, o resolvedor e o executor comum:

- `QUESTION` exige geração textual e pesquisa web e usa somente o contrato interno estável `{ type: "web_search" }`. `NUTRITION_SEARCH` exige geração textual, Structured Output e pesquisa web; `EMBEDDING` é uma capacidade independente consumida pela busca semântica de catálogo por meio do resolvedor e do executor comuns. Não reutilizar o modelo de embeddings como se executasse pesquisa nutricional.
- A matriz representa somente operações implementadas no adapter do projeto. OpenAI expõe métodos explícitos para texto/multimodal, pesquisa web, embeddings, transcrição e imagem; Gemini suporta texto, visão, Structured Output e Google Search Grounding. Embeddings Gemini permanecem indisponíveis até existir método dedicado e teste de integração.
- Todo campo aceito pelo request comum precisa ser traduzido ou rejeitado localmente. O Gemini traduz somente `web_search` para Google Search Grounding e rejeita qualquer outro tipo de ferramenta antes da rede; nunca descarta ferramenta silenciosamente.
- `OPENAI_BASE_URL` não vazio ativa automaticamente o modo `openai-compatible`; o endpoint começa sem operações suportadas e exige allowlist explícita em `AI_OPENAI_COMPATIBLE_OPERATIONS`.
- Timeout e tentativas inválidos tornam a capacidade `invalid`; não são aceitos como configuração pronta.
- O executor rejeita estados `invalid` e `disabled`, limites não positivos/não inteiros e fallback habilitado sem callback antes de qualquer chamada. Estado `degraded` só executa quando o primário continua válido.
- A seleção usa exclusivamente `AI_<CAPABILITY>_*` quando configurado e, caso contrário, o default versionado da capacidade. Aliases globais/modelos antigos não participam mais da resolução desde a #960.
- O fallback usa modelo próprio do provider de destino. Um modelo do primário nunca é reutilizado silenciosamente em provider diferente. Em `NODE_ENV=production`, fallback cross-provider permanece inelegível mesmo com opt-in explícito: a #927 não aprovou essa promoção, que exige nova evidência, revisão de privacidade e autorização operacional por capacidade; fallback same-provider continua seguindo a política da capacidade.
- Erros concretos de SDK/HTTP/rede são classificados pelo executor. Timeout, rede, rate limit recuperável, saída vazia, JSON inválido e payload inválido podem acionar a política limitada; autenticação, modelo ausente, bloqueio de segurança, configuração inválida e erro desconhecido não acionam segundo provider.
- Cada tentativa recebe `AbortSignal`; o contrato `AiProvider` e os adapters OpenAI/Gemini propagam o sinal para a chamada do SDK. Depois do timeout, o executor aguarda o encerramento local da chamada antes de retry/fallback; se a chamada não reconhecer o cancelamento na janela definida, a execução termina sem nova chamada. O cancelamento do cliente não deve ser interpretado como garantia de interrupção do processamento remoto ou de ausência de cobrança pelo provider.
- `MAX_ATTEMPTS` é o total de chamadas do primário. Depois delas, existe no máximo uma chamada de fallback, sem retorno ao primário e sem cadeia adicional.
- Escalonamento de qualidade é política separada e não é ativado nesta fase.
- Degradação funcional local, como busca não semântica ou anotação local, não é fallback de provider.
- O adapter Gemini usa `models.generateContent` com `responseJsonSchema`, preservando recursos dos schemas reais do projeto, como `additionalProperties: false`, nulabilidade e limites numéricos. Os consumidores de refeições possuem testes pelos entrypoints reais para texto e para o data URL inline de imagem produzido pelo WhatsApp.
- Respostas textuais e de embeddings podem expor metadados normalizados de usage; conteúdo sensível e valores de segredo não entram nos diagnósticos.
- Os consumidores migrados em #922-#925 e o helper `imageGeneration.ts` alinhado em #960 devem reutilizar a fundação comum; não criar factory/selector paralelo por consumidor.

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

`QUESTION`, `NUTRITION_SEARCH` e `EMBEDDING` usam a mesma fundação (`resolveCapabilityConfig` + `executeResolvedCapability`/`executeWithPolicy`), com o mesmo comportamento fail-closed dos consumidores de #922. Em `QUESTION`, `AI_QUESTION_WEB_SEARCH_MODE=auto` oferece a ferramenta sem forçá-la; `disabled` (e o alias legado `off` do modo de pesquisa) não envia a ferramenta, e valores desconhecidos falham fechados. Em `NUTRITION_SEARCH`, o resolvedor também valida a combinação provider + modelo + operações: Gemini 2.5 continua elegível para `QUESTION`, mas é rejeitado para Structured Output + Google Search na mesma chamada; apenas um Gemini 3 explicitamente aprovado pode executar essa combinação, e a #927 preservou os defaults por falta de comparação live suficiente. Fonte insuficiente, ferramenta não executada, citação sem suporte à evidência ou incompatibilidade de marca, produto, sabor, peso ou embalagem retorna ao contrato nutricional canônico local, sem probe, retry ou fallback externo oculto dentro da tentativa do executor. Esse retorno mantém a pendência de identidade para marca/variante não comprovada; fallback nutricional genérico só se aplica quando não existe identidade comercial pendente. Variantes ou medidas presentes apenas no candidato são tratadas como ambiguidade, não como correspondência. JSON/payload inválido pode consumir retry/fallback operacional; `found=false` é resultado funcional e não provoca segunda consulta. `EMBEDDING` indisponível ou com espaço vetorial divergente degrada para busca textual/canônica; Gemini segue inelegível por não anunciar `embeddings`.

## Consumidor migrado em #924

`TRANSCRIPTION` usa `resolveCapabilityConfig` + `executeResolvedCapability`, preserva `openai` + `whisper-1` como baseline e aceita texto útil sem `segments`. Texto somente com pontuação ou composto integralmente por marcadores e mensagens auxiliares de silêncio/inaudibilidade, como orientação para tentar novamente, é `empty_output` recuperável e pode acionar retry/fallback; o benchmark usa o mesmo predicado. Conteúdo misto com fala acionável permanece válido. Validação de data URL/base64, MIME, tamanho, payload vazio e configuração ocorre antes do adapter. Retrys são sequenciais; fallback fica desabilitado por padrão e existe no máximo uma chamada posterior quando explicitamente habilitado e elegível.

A regressão do WhatsApp é comportamental: duas entregas do mesmo callback resultam em um único download, uma transcrição e uma mutação. O benchmark usa seis fixtures sintéticos, uma tentativa, sem fallback, execução sequencial e saída sanitizada. O manifesto vazio ou inválido falha antes da rede; taxas sem denominador são `0` e médias sem amostra são `null`, nunca `NaN`/`Infinity`.

Antes de promover modelo em produção, executar `pnpm agent:check`, `pnpm build`, o smoke controlado e o benchmark real descrito em `docs/benchmarks/transcription/results/README.md`. A comparação não altera o default automaticamente.

## Consumidor migrado em #925 e alinhado em #960

`IMAGE_ANNOTATION` possui três modos especializados e independentes de `MEAL_VISION`:

- `local` é o default. Valida MIME/base64/tamanho, auto-orienta uma cópia, compõe SVG por Sharp e cria um PNG derivado com chave distinta, sem criar adapter ou chamada externa.
- `external` valida a foto antes da rede, resolve a capacidade específica e usa o executor comum. Cada tentativa contém exatamente uma operação de imagem; depois das tentativas primárias existe no máximo uma chamada de fallback, se explicitamente habilitada e elegível.
- `off` encerra sem derivado.

Falha externa só degrada para local com `AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=local`; essa transição é degradação funcional e não fallback de provider. Falhas de configuração, provider, renderização local, upload ou envio do derivado não bloqueiam resposta textual, confirmação nem persistência da refeição. O original nunca é sobrescrito ou removido, e cartão-resumo separado não pode ser usado para mascarar ausência de anotação.

O helper `server/_core/imageGeneration.ts` também resolve `IMAGE_ANNOTATION` quando executa geração/edição externa e mantém o fallback PNG local já existente. Não possui factory ou seleção global própria desde a #960.

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

## Continuação de medidas contáveis com marca

A identidade comercial é resolvida antes de pedir gramatura. A ausência de pesquisa ou evidência específica preserva a pendência canônica de identidade; não libera macros genéricos. A continuação textual preserva os resultados dos itens já resolvidos e a data/timezone originais. A resposta só reivindica a pendência exata esperada, evitando que replay de uma pergunta antiga consuma outra operação. Falha ao criar a pendência bloqueia o registro sem persistência parcial. Ver contrato e regressões em [medidas contáveis no WhatsApp](design-docs/whatsapp-countable-measure-passthrough.md).

## Resolução canônica de item alimentar (#1244)

Registro, adição, imagem, áudio transcrito e simulador compartilham `server/foodItemResolution.ts` para quantidade e especificidade comercial. Riscos controlados: (1) a porção canônica local agora precede medidas pessoais/estimadas também na adição, então `user_learned`/`usual_average` só atuam quando não há porção canônica, como no registro; (2) a referência genérica provisória para produto de marca exige confiança ≥ `0.5`, ausência de alternativas e de alegação de rótulo não verificada, e cobertura de **todos** os tokens da identidade sem marca — qualquer token não explicado mantém o fail-closed; (3) `commercial_nutrition_unverified` continua bloqueando a mutação e segue a mesma continuação de identidade/rótulo no WhatsApp. Medidas contáveis de produto com marca mantêm o motivo de identidade/variante, porque a gramatura da unidade depende do produto exato. Regressões em `server/foodItemResolution.issue1244.test.ts`.

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


## Diagnóstico de pressão de memória no runtime (#1257)

O backend registra checkpoints estruturados `[Runtime] memory_operation` nos trechos de maior risco de memória do WhatsApp: download de mídia, persistência do original, normalização Sharp/libvips, criação de data URL/base64 e inferência de mídia (imagem/áudio). A correlação usa somente hash opaco do identificador técnico; telefone, texto, imagem, base64, URL assinada e payload bruto não podem ser registrados.

Para incidentes no Render, correlacione `operation`, `stage`, `correlationId`, `containerMiB`, `memoryLimitMiB`, `rssMiB`, `heapUsedMiB` e `pressureBand`. Um salto grande em `containerMiB`/RSS com heap estável indica pressão nativa/buffers. Pares `start`/`end` são fechados também em falha; os campos escalares `downloadOk`, `preflightOk`, `normalizeOk`, `base64Ok`, `storageOk` e `inferenceOk` indicam onde a operação terminou sem registrar o erro bruto. Os schedulers de recovery de perguntas do WhatsApp, Strava, retenção, usage governance e reconciliação Asaas registram início e fim em toda execução, inclusive sob pressão normal. O recovery de perguntas continua registrando também cada lookup e sua cardinalidade.

Em runtimes com limite de cgroup de até 768 MiB, o Sharp reduz cache interno e concorrência (`memory=8 MiB`, `files=0`, `items=16`, `concurrency=1`) sem reduzir o limite funcional de pixels aceitos. O pipeline persiste o original antes de criar a cópia normalizada/base64 para evitar sobrepor o pico de upload com a alocação nativa de transformação.


**Reenvio após reinício e idempotência do rascunho web (#1308):** o serviço calcula `traceId` a partir da representação original de texto, bytes codificados da mídia, MIME e papel da foto, não da saída variável do provedor. Após verificar owner, vínculo durável V2 e Gate A vigente, consulta `food_d1_web_drafts` por usuário/chave, compara identidade, revisão, refeição, timezone e timestamp exato e restitui o rascunho pendente *sem* repetir transcrição ou visão. Reenvio divergente recebe `food-d1-public-web-draft-operation-scope-changed`, e operação já confirmada não gera novo rascunho. Sem rascunho persistido, o fluxo pode retomar a preparação sob o pin imutável, conservando o mesmo trace. Testes de serviço com store simulado foram adicionados, mas **não demonstram restart real com TiDB**, CI nem homologação externa.

**Proteção de consumidores legados e concorrência do rascunho (#1308):** a edição rápida tokenizada recusa refeições com itens V2 reconhecidos pelo snapshot físico antes de `processMealInput` (V1), consulta de hábitos ou mutação. No plano WhatsApp de incrementos de quantidade, um alvo V2 reconhecido na listagem autenticada é rejeitado antes da consulta de porções V1, com revalidação na leitura imediatamente anterior ao lote; itens V1 continuam no fluxo anterior. `saveFoodD1WebDraft` compara sob lock o escopo imutável da primeira operação com cada inserção concorrente; uma tentativa com mesmo owner/chave e `traceId` ou contexto divergente falha, e uma repetição equivalente usa o mesmo draft físico. O gate TiDB sintético agora também prepara um rascunho pendente em um processo e verifica sua leitura e reuso em um segundo processo Node. **São testes adicionados, não resultados verificados:** sem CI/check-runs no SHA exato e auditoria independente, nenhum critério de aceite é certificado. A migração durável da decisão anterior para rótulo/continuação, as rotas de mídia WhatsApp e os leitores ainda não provados permanecem fora desta conclusão.


**Fronteiras multimodais e rótulo posterior — complemento D1 (#1308, preparo inativo):** a análise pública separada de foto e os dois webhooks WhatsApp rejeitam todos os canais de imagem/combinação selecionados para V2 ainda não migrados (`plate_image`, `packaging`, `nutrition_label`, `multimodal`) **antes de executar o resolvedor legado**. O envio web exige escolha explícita de prato ou frente de embalagem; trocar a imagem limpa a seleção para impedir herança do papel anterior. Uma foto identificada explicitamente como tabela nutricional na criação de *nova* refeição não é alimentada à V1 nem à ponte de novo rascunho V2, mesmo se as flags estiverem OFF: ela requer um item físico existente e uma operação de atualização vinculada, que ainda não foi integrada. A seleção de rótulo informa a limitação e desabilita o botão de novo registro. O contrato de confirmação exige identidade da refeição, timezone e **instante exato** fixados na análise; a tela bloqueia mudança de horário, não só mudança de dia.

**Integridade transacional — complemento D1:** o writer nativo recusa alteração de quantidade/unidade/gramatura em operação `nutrition_label`, mesmo que a identidade da variante seja compatível e a nutrição nova seja verificada; a quantidade original exige ação de edição independente. A gravação de um novo rascunho sob a mesma chave verifica recibos de efeitos duráveis **sob o lock da rota V2**, e a leitura do rascunho expirado/limpo bloqueia reprocessamento de uma operação já confirmada. Os lotes legados WhatsApp rejeitam toda a mutação antes de qualquer efeito se uma refeição do lote contiver snapshot físico V2 autenticado; não tentam compensá-la por V1. Casos positivos e negativos estão representados em testes Vitest e cenários TiDB descartáveis adicionados. **Não há prova de execução CI no SHA deste texto**; o Gate A produtivo de #1335 e o fechamento de #1307 continuam pendentes, assim como o rótulo posterior em item físico, a continuidade multi-turn durável, mídia WhatsApp V2 e a cobertura integral dos leitores. Não habilitar a V2 nem chamar estes testes de certificação independente.

**Foto no endpoint público independente (`foodPhotoAnalysis.analyze`, #1308):** os campos opcionais `imageKind`, `d1OperationId`, `mealLabel` e `occurredAt` preservam compatibilidade com clientes V1. Quando uma modalidade visual está selecionada para V2, o endpoint exige escolha explícita entre prato e frente de embalagem e uma chave estável; consulta o fuso autenticado e reutiliza `tryRunFoodD1PublicWebDraft`, o store durável, a evidência linguística governada e a confirmação pública já existente `nutrition.meals.confirmFoodD1Draft`. Um resultado inválido ou Gate A ausente nunca chama a análise V1. A resposta de rascunho é novamente validada pela identidade do contrato V2, pela chave idempotente vinculada ao usuário autenticado, pelo papel visual selecionado e pelo destino da refeição; resposta pertencente a outra operação é rejeitada sem fallback. Se o rollout for desativado durante uma operação já fixada na V2, até mesmo uma resposta de draft inesperada é recusada antes da análise V1. Mesmo com rollout desligado, uma chave V2 previamente fixada continua submetida ao bloqueio de rollback da mesma operação; uma foto marcada como rótulo de um novo alimento é recusada sem item físico. A fusão de evidências multimodais agora recusa divergência de cardinalidade entre observações com mesma identidade e o pareamento ambíguo de quantidades distintas, preservando irmãos para revisão em vez de inventar porções. **Somente implementação e testes adicionados: sem CI/E2E exact-SHA, sem Gate A/B e sem auditoria independente.**


**Reconciliação D1 — mídia WhatsApp, rótulo e continuidade (issue #1308; preparo técnico sem ativação):** `publicWhatsAppVisualRegistration.ts` e o handler de imagem anotada encaminham ao mesmo resolvedor V2 superfícies observáveis de prato/embalagem com papel visual explícito. `publicNutritionLabel.ts` exige item físico V2 autenticado, decisão anterior estruturada, prova governada independente para o hash exato da foto e revalidação antes do commit; nenhuma foto não verificada é convertida em macro pelo canal. `publicWhatsAppPendingRepository.ts` usa `whatsappPendingOperations` para guardar apenas fatos estruturados com owner, TTL, revisão, manifesto e escopo original, sem reprocessar decisão a partir de texto. A correção desta rodada fixa o ID numérico autenticado em todos os filtros Drizzle/insert da pendência — o retorno do lock de usuário é um registro `{id}`, nunca o inteiro esperado. O gate TiDB sintético adicionou criação, replay, correção CAS, isolamento de usuário, fence de reentrega, consumo e recuperação de uma pendência ainda aberta **em outro processo Node**, sem promover fixtures a Gate A. **Status: código e testes publicados, mas não executados/certificados no HEAD material.** Não ativar flags; #1307, #1335, todos os E2E e a auditoria independente permanecem condições externas de fechamento. A descrição anterior da ausência de rotas WhatsApp/rótulo/continuação corresponde ao estado anterior da PR e é substituída por este complemento.
