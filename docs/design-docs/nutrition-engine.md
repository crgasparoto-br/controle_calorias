# Design técnico: motor nutricional

## Responsabilidade

Converter entradas de refeição em rascunhos revisáveis e, após confirmação, persistir refeições e itens com totais nutricionais consistentes.

## Contrato de alto nível

```text
entrada multimodal -> contrato semântico canônico -> resolução de identidade/nutrição -> revisão/clarificação -> confirmação -> refeição persistida
```

## Diretrizes

- Inferência é sugestão, não verdade final.
- Cálculos de totais devem ser centralizados e reutilizados entre web e WhatsApp.
- Persistência deve separar refeição (`meals`), itens (`mealItems`), mídia (`mealMedia`) e rascunho/inferência (`mealInferences`).
- Campos `sourceText`, `transcript`, `reasoning` e `mediaJson` devem ser tratados como sensíveis.
- Novos modelos de saída de IA devem ser validados com Zod antes de persistir.
- Fotos sem alimento ou bebida consumível identificado com segurança devem gerar falha controlada e pedir nova mídia ou descrição textual; o sistema não deve criar itens de fallback nem registrar refeição automaticamente.
- Em fotos de embalagem, rótulo, etiqueta ou balança, texto legível com nome do produto deve ser tratado como identidade principal do alimento (por exemplo, "pão de cenoura"), sem converter ingredientes do rótulo em itens separados.
- Quando peso líquido, porção declarada ou etiqueta de balança estiver visível, a inferência deve usar esse valor como porção estimada quando compatível com o item identificado.
- Alimentos consumíveis **sem marca/variante explícita** reconhecidos com segurança, mas sem tabela nutricional, correspondência exata de catálogo ou macros confiáveis, podem usar fallback nutricional estimado. Produto com marca ou variante explícita não pode usar esse fallback para fechar a composição nutricional comercial.
- Presença de embalagem transparente, brilho ou reflexo não é evidência suficiente para classificar automaticamente como água; água só deve ser sugerida com evidência explícita.
- Em entradas textuais com quantidade explícita, o texto original do segmento alimentar deve ser usado como candidato de busca nutricional antes do nome canônico retornado pela IA. Isso preserva e prioriza marca, linha, versão e tipo/qualificador, por exemplo `requeijão catupiry light`, `leite piracanjuba zero lactose` ou `iogurte grego light danone`.
- A busca nutricional deve preferir a referência mais específica disponível. Para alimento genérico, referências menos específicas podem continuar sendo usadas como estimativa transparente. Para produto com marca/variante explícita, uma referência menos específica não autoriza composição nutricional: catálogo/pesquisa precisa comprovar a mesma identidade comercial ou o fluxo entra em clarificação.
- Para imagem sem texto-fonte, o motor recompõe a identidade exibida a partir de `foodName` + `brand` estruturada, sem duplicar a marca quando ela já estiver no nome. Os candidatos locais usam primeiro produto + marca + variante + porção; depois de miss local, produtos com marca fazem uma tentativa canônica de `NUTRITION_SEARCH`. Miss ou incompatibilidade não cai em macros genéricos de marca.
- A pesquisa específica não é restrita a chocolates ou biscoitos: qualquer alimento ou bebida industrializada com marca estruturada pode usar o mesmo contrato. A aceitação continua fail-closed para incompatibilidade de produto, marca, variante ou medida, inclusive entre versões regulares, `Zero`, `Light` e equivalentes.
- Imagem com variante explícita só pode promover macros do próprio rótulo a fonte `nutrition_label` quando a extração transportar evidência numérica da porção-base (kcal, proteína, carboidratos e gorduras) e o motor comprovar coerência proporcional com a porção consumida. Mera menção no `reasoning`, evidência incompleta ou valores divergentes permanecem não verificados e seguem fail-closed; sem variante legível, a imagem também não pode escolher silenciosamente uma variante da marca.
- O cleanup de nomes com recipientes deve distinguir a posição semântica do recipiente: `bolo de pote` não é objeto, enquanto `pote`, `pote vazio` e equivalentes flexionados/plurais continuam sendo ruído.
- Em `recipiente + de/com + conteúdo`, alimento conhecido é evidência positiva, mas homônimos genéricos como `água`, `óleo`, `pasta`, `creme`, `gel`, `líquido` e `fluido` não podem neutralizar contexto inequivocamente não alimentar (`água sanitária`, `óleo de motor`, `pasta de dente`, por exemplo).
- A fronteira é de mundo aberto: preparações culinárias ausentes do catálogo continuam revisáveis. A decisão não pode usar ausência em allowlist alimentar nem ausência em denylist de objetos como evidência semântica; descarte exige evidência negativa afirmativa por família/contexto, e regressões devem incluir positivos e negativos inéditos fora das frases codificadas em produção.

## Contrato semântico canônico (#1051)

`processMealInput` retorna `CanonicalMealProcessingResult`, que exige `semanticContract` para toda nova execução. `MealProcessingResult.semanticContract` permanece opcional apenas para compatibilidade de leitura com snapshots históricos criados antes da #1051.

O contrato é construído depois da resolução nutricional e antes de qualquer mutação do chamador. Ele contém:

- `originalText`, `normalizedText`, `inputType` e intenção;
- por item: nome comercial, categoria, marca, variante, quantidade, unidade, porção e gramas estimados;
- confiança separada de identidade, quantidade e fonte;
- evidência por campo com `origin`, `confidence` e `verified`;
- composição nutricional com URLs/evidência/data quando disponíveis;
- alternativas plausíveis, `needsClarification` e motivo estruturado;
- `barcode: null` enquanto o pipeline não possuir leitura estruturada e confiável desse campo — ausência não é preenchida por inferência.

As origens atualmente normalizadas são `text`, `transcription`, `ocr`, `vision`, `memory`, `catalog`, `web_research`, `nutrition_label`, `ai_estimate`, `heuristic` e `unavailable`. Texto, transcrição e imagem compartilham o mesmo resolvedor; `inputType` descreve a combinação de canais, enquanto cada campo mantém sua própria procedência. Em entrada multimodal, a simples presença de imagem não transforma quantidade digitada em `vision`: identidade/marca/variante, quantidade e gramas estimados são resolvidos separadamente. Produtores que já conhecem uma origem mais específica, como OCR estruturado ou memória pessoal, podem fornecê-la em `semanticEvidenceOrigins`; na ausência desse hint, o contrato deriva a origem a partir do canal que realmente sustenta o valor e da fonte nutricional final.

Quando o contrato contém `brand_variant_unresolved` ou `commercial_identity_unverified`, `processMealInput` lança `food_identity_clarification_required` antes de retornar um rascunho mutável. O erro leva o próprio `semanticContract`, identidade, marca, alternativas e razão estruturada. No registro confirmado do WhatsApp, `confirmedMealRegistration` transforma esse erro em `details_needed` antes de `createDraft`/`confirmMeal`; `mealIntentDecisionInteraction` reutiliza a continuação persistente de detalhes existente para guardar o texto original antes da pergunta ao usuário. Não existe fila paralela específica da #1051.

## Compatibilidade semântica de variantes

- Todo candidato final deve passar pelo mesmo guard semântico, independentemente de vir do catálogo estático ou persistido, alias pessoal, TACO, busca semântica, busca web ou fluxo do WhatsApp.
- O nome canônico tem precedência sobre aliases. Um alias genérico não pode neutralizar qualificadores críticos do nome canônico.
- Variantes contraditórias não são equivalentes: `com açúcar`, `adoçado`, `sem açúcar`, `zero`, `diet`, `puro`, `com leite`, `com mel`, `com creme` e `com leite condensado` devem permanecer semanticamente distintas. Para bebidas, o qualificador explícito do segmento original também governa a validação de candidatos TACO quando a IA simplificar o nome inferido.
- Para produtos com marca, `isPersistedProductIdentityCompatible` também governa candidatos locais/persistidos no resolvedor principal. Uma consulta genérica da marca não aceita uma variante específica só porque a marca coincide.
- Quando a marca estiver explícita e a variante não estiver, o cache do catálogo pode ser usado somente para listar alternativas plausíveis da mesma família/mesma marca; essas alternativas não são automaticamente promovidas a escolha nutricional.
- O fallback heurístico de bebida zero deve ser ativado por evidência positiva de que a descrição tem uma bebida como núcleo (família de bebida ou marca gaseificada em contexto compatível). Termos como `refrigerante`, `tônica`, `soda`, `cola` ou `guaraná` usados apenas como sabor, tipo, ingrediente ou referência dentro de outro alimento não podem ser suficientes; a regra não deve depender de uma blacklist fechada de alimentos sólidos. Se houver marca/variante explícita pendente, a política comercial fail-closed prevalece sobre o fallback heurístico.
- Referências qualificadas como `Café sem açúcar` não podem ser usadas para `café`, `café com açúcar` ou qualquer preparação com complemento calórico.
- Fuzzy matching e aliases aprendidos não podem remover, inverter ou inventar qualificadores nutricionais.
- Quantidades e unidades de porção, como `1 xícara`, participam do cálculo, mas não impedem a identificação lexical do alimento.

## Política de estimativas transparentes

A ausência de um valor exato não deve transformar a clarificação ao usuário no primeiro fallback quando o domínio possui base suficiente para produzir uma estimativa útil e defensável. Essa política aplica-se a alimentos genéricos e à resolução de **quantidade**; ela não autoriza preencher composição nutricional de produto com marca/variante sem evidência comercial compatível.

Para quantidade/medida caseira, a precedência é:

```text
massa/volume explícitos
-> porção canônica local
-> referência exata verificável da medida
-> referência pessoal anterior da mesma identidade/medida
-> média usual coerente
-> estimativa contextual verificável
-> clarificação
```

Regras:

- `canonical_portion` e `researched_exact` são fontes específicas e têm precedência sobre referências pessoais ou estimadas;
- `user_learned` é uma referência pessoal da mesma identidade, marca/variante quando aplicável e medida, criada somente após correção explícita bem-sucedida; nunca atravessa usuários ou identidades diferentes;
- `usual_average` continua vinculada ao alimento/tipo/preparo e à medida física; não existe peso universal de `fatia`, `unidade`, `colher` ou `xícara`;
- uma fonte que declare explicitamente média/usual/típica pode sustentar `usual_average`; duas ou mais referências independentes e coerentes também podem produzir o valor central;
- uma única referência verificável que não se declare típica pode produzir `contextual_estimate` somente para o mesmo alimento/tipo/preparo, com relação quantidade-unidade-gramas verificável e medida fisicamente definida;
- medidas vagas como `porção`, `pedaço`, `pacote` e `punhado` não são promovidas automaticamente a `contextual_estimate` por uma referência isolada;
- duas ou mais referências verificadas que divirjam materialmente obrigam clarificação; não é permitido escolher uma delas arbitrariamente;
- uma referência explícita da mesma marca/variante tem precedência sobre média de categoria;
- uma referência de alimento genérico compatível pode estimar **quantidade** somente quando não houver identidade comercial explícita pendente; para produto com marca/variante explícita, a medida deve ser comprovada para a mesma identidade comercial antes de qualquer média ou fallback de categoria;
- gramatura estimada e composição nutricional são decisões separadas e devem ter compatibilidade semântica independente;
- toda estimativa utilizada deve manter procedência suficiente para distinguir valor exato/canônico, medida exata pesquisada, referência pessoal aprendida, média usual, estimativa contextual e fallback nutricional;
- resoluções pesquisadas reutilizáveis são persistidas com validade temporal; registro expirado volta a ser miss e pode ser verificado novamente;
- o armazenamento durável de resolução/aprendizado é por usuário e identidade; memória de processo não é fonte de verdade para reuse após restart ou múltiplas instâncias;
- `usual_average`, `contextual_estimate` e `user_learned` devem ser marcados como aproximações na resposta, preservando a medida original e os gramas efetivamente usados;
- correção explícita só pode gerar aprendizado depois que a mutação canônica da refeição concluir; falha, cancelamento, ambiguidade ou stale não ensinam;
- handlers de canal não devem manter tabelas/constantes paralelas de médias; a política pertence ao domínio nutricional e deve ser reutilizada por web e WhatsApp.

## Componentes calóricos sem quantidade

- Quando a preparação contém açúcar e a quantidade está explícita, o motor incorpora o açúcar uma única vez aos macros e calorias do café.
- A heurística determinística de café-base mais açúcar só é válida quando açúcar é o único complemento calórico do segmento. Preparações também qualificadas por leite, mel, creme, leite condensado ou outro complemento devem preservar uma estimativa coerente da preparação completa ou usar fallback baseado no segmento completo; nunca podem ser reduzidas a `Café com açúcar` com os demais macros zerados.
- A porção-base do café adoçado deve vir da referência canônica `cafe-sem-acucar`; atualmente `1 xícara` equivale a `200 ml` e `2 kcal`. Não é permitido manter outra constante local para o tamanho da xícara.
- A energia do açúcar continua usando `4 kcal/g` no cálculo determinístico vigente.
- Quantidade explícita de açúcar sempre tem precedência. Por isso, `1 xícara de café com 5 g de açúcar` e `200 ml de café com 5 g de açúcar` são nutricionalmente equivalentes: aproximadamente `205 g`, `22 kcal` e `5 g` de carboidratos.
- Para **café com açúcar simples** sem quantidade explícita de açúcar, a média operacional canônica inicial do produto é **5 g de açúcar por xícara de 200 ml**. Essa é uma regra operacional para permitir registro sem interrupção, não uma afirmação de que todos os usuários adoçam o café dessa forma.
- A média escala proporcionalmente ao volume ou ao número de xícaras reconhecido. Exemplo: `100 ml de café com açúcar` usa aproximadamente `2,5 g` de açúcar; `2 xícaras` usam aproximadamente `10 g`.
- Se o usuário não informar volume, o motor usa a porção canônica de uma xícara (`200 ml`) e, portanto, estima aproximadamente `22 kcal` e `5 g` de carboidratos para `café com açúcar` simples.
- Quando uma estimativa utilizável da IA já representa a preparação adoçada, ela pode ser preservada desde que passe pelo guard semântico e seja coerente com a preparação. Se houver quantidade explícita de açúcar, a estimativa também deve cobrir ao menos as calorias e os carboidratos desse açúcar.
- Para o caso simples sem açúcar explícito, `food_component_quantity_required` **não** deve ser retornado apenas porque faltaram os gramas de açúcar. O motor deve registrar usando a média operacional, marcar o açúcar como estimado e informar o usuário de que a estimativa pode ser corrigida depois pelo WhatsApp ou pela tela de ajuste.
- `food_component_quantity_required` continua válido quando houver complemento calórico cuja quantidade não possa ser resolvida nem estimada com segurança suficiente, especialmente em preparações compostas nas quais aplicar a média simples produziria composição enganosa.
- O WhatsApp só transforma esse erro em `food_clarification.quantity` quando a estimativa realmente não for possível pelo contrato acima; não deve criar pendência para `café com açúcar` simples.
- A resposta pode usar massa ou medidas domésticas suportadas pelo contrato (`g`, colher de chá, colher de sopa, sachê ou pacote). A unidade anunciada ao usuário deve ser aceita pelo parser e convertida uma única vez pelo cálculo do complemento.
- A média operacional de `5 g/200 ml` deve existir em uma única fonte canônica do domínio. Não deve ser duplicada em prompts, parsers, handlers ou código específico do WhatsApp.

Exemplo de resposta conceitual para ausência de quantidade explícita:

```text
Café com açúcar — 1 xícara (200 ml)
≈ 22 kcal | C 5 g
Açúcar estimado: 5 g (média operacional). Você pode ajustar depois pelo WhatsApp ou na tela da refeição.
```

## Pontos de atenção para agentes

- Antes de alterar confirmação de refeição, conferir impactos em dashboard, relatórios, favoritos e hábitos.
- Antes de alterar cálculo nutricional, adicionar teste de regressão.
- Antes de alterar prompts ou parsing de IA, revisar `docs/PRIVACY_LGPD.md`.

## Execução por capacidade de refeição (#922)

`extractWithAi` seleciona `MEAL_TEXT` sem imagem e `MEAL_VISION` com imagem. Ambas usam `executeResolvedCapability`, propagam `AbortSignal`, preservam o schema real e aplicam Zod após qualquer tentativa primária ou fallback. A fronteira `_core/ai/domainTextResponse.ts` remove respostas `raw` dos SDKs antes de entregar dados ao domínio.

A classificação NOVA permanece no objeto `foodClassification` da mesma resposta. Não há classificador separado, chamada por item ou consumidor de `FOOD_CLASSIFICATION`. Classificações históricas sem correspondência determinística ficam para revisão/curadoria, sem reclassificação externa automática. Escalonamento de qualidade não está ativo nesta entrega e, se evoluir, pertence somente a `MEAL_VISION` com configuração explícita e separado do fallback operacional.

## Pesquisa nutricional e embedding por capacidade (#923)

`findPackagedSnackByWebSearch` (`server/catalogSemanticSearch.ts`) é a fronteira histórica, agora reutilizada para pesquisa específica de produtos industrializados com marca. Ela resolve `NUTRITION_SEARCH` via `resolveCapabilityConfig` e executa através de `executeResolvedCapability`, com a ferramenta `{ type: "web_search" }` oferecida ao provider e Structured Output estrito no schema de resultado. Se `policy.state` for `disabled` ou `invalid`, ou o primário não puder ser resolvido, a função retorna `null` imediatamente, sem chamar rede. Para produto genérico, o chamador pode seguir para estimativa canônica; para produto com marca/variante explícita, `null` mantém identidade pendente e conduz a clarificação, em vez de autorizar macros genéricos ou estimativa da LLM.

- Fonte insuficiente: o prompt instrui o provider a retornar `found=false` quando houver dúvida sobre SKU, sabor, peso ou marca. A aceitação exige `webSearch.executed=true`, identidade compatível e uma fonte vinculada pelo provider cujo `title`/`supportingText` contenha a porção e os valores numéricos usados para kcal, proteína, carboidratos e gorduras. O campo estruturado `result.evidence` é apenas resumo produzido pelo modelo e **não participa da comprovação numérica**; ele não pode preencher número ausente na fonte. A evidência persistida em `sourceEvidence` é derivada do próprio material sustentado pela fonte aceita. OpenAI pode validar a URL citada diretamente; Gemini pode fornecer URI opaca de redirecionamento, então o adapter normaliza `groundingSupports` e associa os segmentos sustentados aos respectivos `groundingChunks`. Uma URL escrita pelo modelo que não aparece nas citações não é confiável; quando a URI é opaca, a evidência precisa estar ligada ao chunk pelo grounding. O texto livre de uma chamada adicional de recuperação nunca é convertido em `supportingText`: somente segmentos ligados nativamente a `url_citation` ou `groundingSupports` estabelecem procedência. URLs sem esse vínculo permanecem insuficientes e degradam para o comportamento fail-closed aplicável à identidade.
- Identidade comercial: antes de aceitar o candidato, a busca compara termos significativos, qualificadores e medidas nas duas direções. Termo de sabor/SKU ou medida presente apenas no candidato torna a entrada genérica ambígua e retorna `null`; portanto `Trento` não pode selecionar silenciosamente `Trento Chocolate Branco Dark 32 g`. O texto consultado só vira alias depois da validação. Divergência ou informação comercial não identificada retorna `null` mesmo com confiança alta e fonte válida; o guard semântico compartilhado ainda é aplicado em seguida.
- O resolvedor principal reaplica compatibilidade comercial a candidatos locais/persistidos e não aceita uma variante específica para consulta genérica de marca. Candidatos da mesma marca podem ser expostos apenas como alternativas de clarificação.
- Compatibilidade Gemini: `QUESTION` pode usar Gemini 2.5 com Google Search. `NUTRITION_SEARCH` combina Google Search e Structured Output na mesma chamada e, por isso, requer modelo Gemini 3 explicitamente configurado. `gemini-2.5-flash` é recusado pelo resolvedor antes da rede; a #927 preservou OpenAI como default por falta de comparação live suficiente.
- JSON inválido ou payload estruturalmente inválido é rejeitado dentro da callback entregue a `executeResolvedCapability`, portanto segue a taxonomia operacional comum e pode consumir retry/fallback único quando explicitamente habilitado. Já `found=false`, confiança insuficiente, fonte ausente/não citada, evidência vazia ou identidade comercial incompatível são resultados funcionais processados depois do executor: retornam `null` e degradam diretamente para a política do resolvedor, sem nova consulta externa.
- Para identidade comercial explícita, `null` ou miss após a tentativa segura não inventa dado nem libera `hybrid`: o contrato semântico marca a pendência e o motor exige clarificação antes de mutação. Para alimento sem marca/variante, os fallbacks transparentes existentes continuam disponíveis.

A busca semântica de catálogo usa a capacidade `EMBEDDING` (default OpenAI `text-embedding-3-small`) para gerar o vetor da consulta e comparar por similaridade de cosseno com o catálogo pré-embebido. O cache registra o provider/modelo efetivamente usado pelo executor; se a consulta vier de outro modelo efetivo, o cache é invalidado e a chamada degrada para a busca textual/canônica, sem comparar espaços vetoriais diferentes. Quando `EMBEDDING` está `disabled`/`invalid`, a busca semântica é pulada sem chamar rede — mesma política de "nunca substituir geração de texto por embeddings ausentes" coberta em `catalogSemanticSearch.test.ts`.

## Auditoria incremental da issue #1090 — ownership nutricional e baseline

A baseline auditável desta fase é a `develop` no SHA `34b210e8ed8a4f9169bc2cb11c1db5cecf367b5c`. O fluxo alimentar deve transportar decisões estruturadas e manter evidência original separada de fatos derivados. Esta seção registra o inventário inicial e as disposições obrigatórias da Fase 0; não autoriza uma refatoração funcional ampla antes dos golden flows da Fase 1.

### Inventário mínimo de informação e ownership

| Informação | Origem na entrada | Owner atual | Transformações permitidas | Verificação/imutabilidade | Destino |
| --- | --- | --- | --- | --- | --- |
| Texto/segmento original | WhatsApp/web/transcrição/OCR | `whatsappPersistentContextWebhook`, `processMealInput` e `semanticContract.originalText` | Normalização para matching sem sobrescrever o original | Imutável como evidência do turno; conteúdo sensível | Lifecycle, contrato semântico, `sourceText`/notes quando aplicável |
| Nome/candidato do alimento | Extração e parser | `processMealInput` + `mealTextParsing` | Canonicalização e alias somente após validação | Candidato não é fato verificado por si | Item e `semanticContract.commercialName` |
| Marca | Texto/IA/OCR/catalog/search | `processMealInput` e resolvedor comercial | Normalização; não inventar quando ausente | Verificada somente com identidade comercial aceita | Item, contrato, identidade de pesquisa |
| Variante | Texto/IA/OCR/catalog/search | `commercialProductIdentity` + guard semântico do engine | Extrair tokens e comparar em ambas as direções | Divergência mantém fail-closed/clarificação | `item.resolution.productVariant`, contrato e catálogo |
| Quantidade/unidade originais | Parser do segmento/IA | `mealTextParsing` + `countableFoodQuantity` | Normalizar unidade; não converter massa-volume sem densidade | Preservar expressão original; decisão derivada separada | Item, pendência ou resolução de medida |
| Gramatura resolvida | Porção canônica, pesquisa ou medida doméstica | `householdMeasureResolution` e `countableFoodQuantity` | Converter para gramas com fonte e relação verificáveis | `measureResolution.verified` e origem explícita | Item, contrato e persistência nutricional |
| Origem/tipo da gramatura | Catálogo, pesquisa, média ou usuário | `householdMeasureResolution`/contrato semântico | Apenas classificação canônica de origem | Não reduzir `researched_exact`, `usual_average` e `contextual_estimate` ao mesmo tipo | `measureResolution.kind`, evidência e resposta |
| Identidade comercial aceita | Catálogo/cache/pesquisa | `resolveCommercialFoodIdentity` e guard compartilhado | Transporte estruturado downstream; sem reconstrução textual para nova inferência | Aceita somente compatibilidade de produto, marca, variante e medida | `CatalogFood`, `MealProcessingResult`, contrato e item persistido |
| Calorias/macros | Catálogo, rótulo ou pesquisa grounding | `nutritionEngine`/builders | Escala proporcional à gramatura; sem macros genéricos para marca pendente | `nutritionVerified`, origem e evidência | Item, totais e snapshot persistido |
| URLs/evidência/data/confiança | Boundary de catálogo/pesquisa | `CatalogFood` e `MealItemResolutionMetadata` | Copiar sem ampliar ou fabricar grounding | Evidência vinculada à fonte aceita | Contrato, item e auditoria operacional permitida |
| Estado de verificação | Guard de identidade e fonte | `nutritionEngine` + `buildMealSemanticContract` | Derivar somente de decisões comprovadas | `verified`/clarificação antes da mutação | Contrato e persistência |
| Razão de clarificação/rejeição | Guard, `MealInferenceError`, pendência | Engine e repositório de operações WhatsApp | Mapear para reason code estruturado | Pendência deve bloquear mutação até resolução | Usuário via mensagem canônica e lifecycle |
| Correlação técnica sanitizada | Inbound/lifecycle/telemetria | `messageLifecycle` e observabilidade | Somente identificadores técnicos permitidos | Nunca incluir conteúdo, segredo, URL assinada ou telefone completo | Logs/telemetria de baixa cardinalidade |

### Findings com disposição obrigatória

Cada finding abaixo possui uma única disposição, conforme o contrato da issue. A disposição se refere ao próximo trabalho autorizado, não a uma afirmação de que a remoção já ocorreu.

| ID | Finding e evidência | Categoria | Disposição | Owner/condição de encerramento |
| --- | --- | --- | --- | --- |
| F0-01 | `isPersistedProductIdentityCompatible` e `isCommercialProductIdentityCompatible` compartilham normalização, tokens, variantes e medida, mas têm invariantes diferentes para identidade persistida e candidato comercial novo. | Duplicação aparente | `keep` | `commercialProductIdentity.ts` continua owner temporário; Fase 2 deve extrair predicados comuns somente com testes bidirecionais e preservar os guardas distintos. |
| F0-02 | `prepareCountableFoodRegistration` e `prepareCountableFoodRegistrationResolved` duplicam segmentação/parsing e reescrita, enquanto a segunda adiciona pesquisa, medida e proveniência. | Duplicação/intermediação | `consolidate` | Fase 2 deve definir uma função canônica de preparação; a função histórica só pode permanecer como adaptador compatível se consumidores forem comprovados. |
| F0-03 | A resolução contável produz estrutura validada e o gate materializa novamente um `MealProcessingResult`/`semanticContract` a partir de `CatalogFood`. | Responsabilidade no lugar errado | `defer` | Fase 1 deve medir o contrato do passthrough; Fase 2 deve escolher builder canônico de domínio ou justificar o builder de canal sem perder proveniência. |
| F0-04 | `recoverCanonicalCommercialIdentity` executa `processMealInput` com `skipCommercialNutritionSearch` para recuperar marca antes de outra resolução. | Intermediação/re-resolução | `defer` | Fase 1 deve contar chamadas por item; Fase 2 só pode eliminar o preflight quando a marca/variante estruturada puder ser transportada com segurança. |
| F0-05 | `server/whatsappWebhook.ts` é fachada fina, mas a rota Express passa por quatro wrappers anteriores e duas implementações de mídia/fallback. | Drift de código/documentação | `keep` | A composição real foi documentada em `ARCHITECTURE.md` e `whatsapp-ingestion.md`; consolidação fica para subissue específica após caracterização. |
| F0-06 | Há implementações paralelas `whatsappWebhook*`, `whatsappIntentWebhook*`, `whatsappAnnotatedImageWebhook*` e `whatsappImageIdempotencyWebhook*`, com precedência e lifecycle distintos. | Responsabilidade/wrappers | `defer` | Fase 1 deve cobrir o POST real; Fase 3 poderá remover bridges apenas com prova de reachability e regressão equivalente. |
| F0-07 | Testes de #1072 cobrem Panco, catálogo vazio, limite de pesquisa e passthrough; a cobertura do entrypoint público ainda não é uma matriz completa e não deve depender apenas de Panco. | Teste frágil/incompleto | `consolidate` | Fase 1 adiciona golden flows parametrizados para Wickbold, comercial não-pão, genérico, massa, variante, grounding, cache, clarificação, áudio e imagem. |
| F0-08 | Código morto ou bridge seguro não foi removido nesta fase porque a reachability dos wrappers e consumidores não está fechada somente por inspeção textual. | Código morto/obsoleto | `defer` | Fase 3 deve anexar consumidores migrados, substituto e teste de regressão antes de cada remoção. |

### Invariantes de transporte

A partir desta baseline, a decisão de identidade comercial aceita e a decisão de medida resolvida são fatos derivados imutáveis para as etapas downstream. O texto, quantidade e unidade originais permanecem disponíveis como evidência. Um consumidor não pode transformar um `CatalogFood` já validado novamente em texto para que outro pipeline redescubra identidade, porção ou marca. Se a etapa seguinte exigir `MealProcessingResult`, a construção deverá receber a decisão estruturada e a proveniência como entrada, nunca inferi-las novamente.

A preparação contável deve preservar o limite canônico: no máximo uma operação específica de `NUTRITION_SEARCH` por item, sem segunda tentativa oculta para outra representação textual. `NUTRITION_SEARCH` indisponível, grounding insuficiente, identidade incompatível ou cache incompatível devem permanecer fail-closed para produtos comerciais. Código compartilhado não pode relaxar privacidade, atomicidade, idempotência, source grounding ou a política de estimativa genérica.

### Owners canônicos provisórios por decisão

Para evitar que “owner atual” seja interpretado como múltiplos decisores concorrentes, a Fase 0 fixa a seguinte leitura até a Fase 2. Módulos de transporte podem carregar os valores, mas não podem tomar a decisão novamente.

| Decisão | Owner canônico provisório | Componentes auxiliares permitidos | Não pertence a |
| --- | --- | --- | --- |
| Preservação da evidência original do inbound | `messageLifecycle` para o turno e `processMealInput`/`buildMealSemanticContract` para o contrato semântico | `whatsappPersistentContextWebhook`, builders de persistência e pendências podem copiar sem sobrescrever | `countableFoodRegistrationGate` não pode substituir o texto original pelo texto reescrito |
| Parsing de quantidade/unidade | `mealTextParsing` e vocabulário compartilhado | `countableFoodQuantity` pode selecionar o segmento contável e normalizar a unidade | handlers WhatsApp não mantêm parser ou tabela de unidade concorrente |
| Identidade comercial aceita | `resolveCommercialFoodIdentity` dentro do `nutritionEngine` | catálogo/cache/search e `commercialProductIdentity` apenas fornecem candidatos/predicados de compatibilidade; preflight é bridge transitório | `processMealInput` no preflight e canal não podem re-resolver identidade já aceita |
| Compatibilidade de produto, variante e medida | guard compartilhado de identidade comercial, atualmente exposto por `commercialProductIdentity.ts` | resolvers podem chamar o guard com o contrato completo | não manter dois validadores materialmente iguais sincronizados manualmente |
| Gramatura/porção resolvida | `resolveHouseholdMeasure`/`householdMeasureResolution` | `countableFoodQuantity` transporta request, origem e resultado; catálogos fornecem referências | WhatsApp não define médias, densidades ou fallback de medida próprio |
| Contrato semântico | `buildMealSemanticContract` no domínio nutricional | `materializeResolvedCommercialSegment` pode construir um resultado transitório a partir de decisão estruturada | o gate não pode inferir novamente marca, variante, quantidade ou origem |
| Construção de item persistível e totais | `mealItemBuilders` + `calculateMealTotals` | gate contável pode adaptar o contrato enquanto F0-03 estiver `defer` | wrappers de canal não podem criar fórmulas ou totals paralelos |
| Clarificação e retomada | `MealInferenceError` + repositório de operações/continuação WhatsApp | handlers apenas traduzem o reason code e retomam o contrato persistido | nenhuma etapa pode persistir parcialmente antes da clarificação |
| Pesquisa nutricional externa | `catalogSemanticSearch` via capacidade `NUTRITION_SEARCH` | `createNutritionSearchTrace` e telemetria sanitizada | preflight/fallback não pode emitir segunda pesquisa por representação alternativa |

Esses owners são uma decisão de leitura da baseline, não uma mudança de implementação. Findings F0-01 a F0-04 permanecem abertos para a Fase 2 porque a consolidação deve provar equivalência e preservar os invariantes antes de transformar o owner provisório em uma API única.


## Consolidação da Fase 2 — issue #1095

A Fase 2 confirmou e tornou executáveis os owners provisórios da baseline. `commercialProductIdentity.ts` possui um comparador lexical compartilhado para normalização, tokens, variantes e medidas; os guards de identidade persistida e de candidato comercial novo permanecem separados porque suas políticas de aceitação não são equivalentes.

A preparação de medidas contáveis tem um único owner assíncrono em `prepareCountableFoodRegistrationResolved`. O export histórico `prepareCountableFoodRegistration` é apenas um adaptador local síncrono para consumidores legados e não contém uma segunda decisão de parsing/porção. A resolução textual estruturada de marca/variante é feita por `resolveStructuredCommercialIdentity`; o adaptador histórico `recoverCanonicalCommercialIdentity` não reabre `processMealInput`.

A materialização de uma decisão comercial aceita pertence ao domínio: `buildItemFromResolvedCommercialFood` constrói o item preservando identidade, variante, macros e proveniência do `CatalogFood`, enquanto `materializeResolvedCommercialMeal` constrói o resultado, o contrato semântico e os totais. O gate WhatsApp e a adição canônica transportam essa estrutura; não convertem um produto aceito em texto para redescobrir a mesma decisão. A expressão original e sua quantidade/unidade permanecem separadas da gramatura derivada e da relação física usada no cálculo.

A matriz da #1094 continua sendo o controle operacional: nenhum produto comercial emite mais de uma operação outbound de `NUTRITION_SEARCH` por item, as decisões aceitas são monotônicas até persistência e falhas de variante, grounding ou medida permanecem fail-closed. A evidência de baseline e comparação está em `docs/testing/issue-1095-ownership-consolidation.md`.
