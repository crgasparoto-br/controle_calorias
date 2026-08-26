# Design técnico: motor nutricional

## Responsabilidade

Converter entradas de refeição em rascunhos revisáveis e, após confirmação, persistir refeições e itens com totais nutricionais consistentes.

## Contrato de alto nível

```text
entrada multimodal -> rascunho de inferência -> revisão -> confirmação -> refeição persistida
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
- Alimentos consumíveis reconhecidos com segurança, mas sem tabela nutricional, correspondência exata de catálogo ou macros confiáveis, podem usar fallback nutricional estimado para evitar rascunhos com calorias e macronutrientes zerados.
- Presença de embalagem transparente, brilho ou reflexo não é evidência suficiente para classificar automaticamente como água; água só deve ser sugerida com evidência explícita.
- Em entradas textuais com quantidade explícita, o texto original do segmento alimentar deve ser usado como candidato de busca nutricional antes do nome canônico retornado pela IA. Isso preserva e prioriza marca, linha, versão e tipo/qualificador, por exemplo `requeijão catupiry light`, `leite piracanjuba zero lactose` ou `iogurte grego light danone`.
- A busca nutricional deve preferir a referência mais específica disponível: alimento + marca + tipo/qualificador, depois alimento + marca, depois alimento + tipo/qualificador e somente então alimento genérico. Quando houver fallback menos específico, o nome original completo deve continuar preservado para exibição, auditoria e comandos posteriores.
- Para imagem sem texto-fonte, o motor recompõe a identidade exibida a partir de `foodName` + `brand` estruturada, sem duplicar a marca quando ela já estiver no nome. Os candidatos locais usam primeiro produto + marca + variante + porção; depois de miss local, produtos com marca fazem uma única tentativa canônica de `NUTRITION_SEARCH` antes de embedding/fallback.
- A pesquisa específica não é restrita a chocolates ou biscoitos: qualquer alimento ou bebida industrializada com marca estruturada pode usar o mesmo contrato. A aceitação continua fail-closed para incompatibilidade de produto, marca, variante ou medida, inclusive entre versões regulares, `Zero`, `Light` e equivalentes.
- O cleanup de nomes com recipientes deve distinguir a posição semântica do recipiente: `bolo de pote` não é objeto, enquanto `pote`, `pote vazio` e equivalentes flexionados/plurais continuam sendo ruído.
- Em `recipiente + de/com + conteúdo`, alimento conhecido é evidência positiva, mas homônimos genéricos como `água`, `óleo`, `pasta`, `creme`, `gel`, `líquido` e `fluido` não podem neutralizar contexto inequivocamente não alimentar (`água sanitária`, `óleo de motor`, `pasta de dente`, por exemplo).
- A fronteira é de mundo aberto: preparações culinárias ausentes do catálogo continuam revisáveis. A decisão não pode usar ausência em allowlist alimentar nem ausência em denylist de objetos como evidência semântica; descarte exige evidência negativa afirmativa por família/contexto, e regressões devem incluir positivos e negativos inéditos fora das frases codificadas em produção.

## Compatibilidade semântica de variantes

- Todo candidato final deve passar pelo mesmo guard semântico, independentemente de vir do catálogo estático ou persistido, alias pessoal, TACO, busca semântica, busca web ou fluxo do WhatsApp.
- O nome canônico tem precedência sobre aliases. Um alias genérico não pode neutralizar qualificadores críticos do nome canônico.
- Variantes contraditórias não são equivalentes: `com açúcar`, `adoçado`, `sem açúcar`, `zero`, `diet`, `puro`, `com leite`, `com mel`, `com creme` e `com leite condensado` devem permanecer semanticamente distintas. Para bebidas, o qualificador explícito do segmento original também governa a validação de candidatos TACO quando a IA simplificar o nome inferido.
- O fallback heurístico de bebida zero deve ser ativado por evidência positiva de que a descrição tem uma bebida como núcleo (família de bebida ou marca gaseificada em contexto compatível). Termos como `refrigerante`, `tônica`, `soda`, `cola` ou `guaraná` usados apenas como sabor, tipo, ingrediente ou referência dentro de outro alimento não podem ser suficientes; a regra não deve depender de uma blacklist fechada de alimentos sólidos.
- Referências qualificadas como `Café sem açúcar` não podem ser usadas para `café`, `café com açúcar` ou qualquer preparação com complemento calórico.
- Fuzzy matching e aliases aprendidos não podem remover, inverter ou inventar qualificadores nutricionais.
- Quantidades e unidades de porção, como `1 xícara`, participam do cálculo, mas não impedem a identificação lexical do alimento.

## Política de estimativas transparentes

A ausência de um valor exato não deve transformar a clarificação ao usuário no primeiro fallback quando o domínio possui base suficiente para produzir uma estimativa útil e defensável.

Para quantidade/medida caseira, a precedência é:

```text
massa/volume explícitos
-> porção canônica local
-> referência exata verificável da medida
-> média usual contextual defensável
-> clarificação
```

Regras:

- uma média usual deve continuar vinculada ao alimento/tipo/preparo e à medida física; não existe peso universal de `fatia`, `unidade`, `colher` ou `xícara`;
- uma referência explícita da mesma marca/variante tem precedência sobre média de categoria;
- quando a média usual de um alimento genérico compatível for usada para estimar **quantidade** de um produto de marca, isso não autoriza substituir a composição nutricional específica do produto;
- a média usual deve vir de fonte que declare medida média/usual/típica ou de múltiplas referências compatíveis que permitam derivar um valor central coerente;
- a primeira referência encontrada não pode ser tratada automaticamente como média;
- gramatura estimada e composição nutricional são decisões separadas e devem ter compatibilidade semântica independente;
- toda estimativa utilizada deve manter procedência suficiente para distinguir valor exato/canônico, medida exata pesquisada, média usual estimada e fallback nutricional;
- a resposta ao usuário deve marcar a quantidade como aproximada quando aplicável e oferecer correção posterior, sem exigir confirmação prévia se a estimativa cumprir o contrato;
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

`findPackagedSnackByWebSearch` (`server/catalogSemanticSearch.ts`) é a fronteira histórica, agora reutilizada para pesquisa específica de produtos industrializados com marca. Ela resolve `NUTRITION_SEARCH` via `resolveCapabilityConfig` e executa através de `executeResolvedCapability`, com a ferramenta `{ type: "web_search" }` oferecida ao provider e Structured Output estrito no schema de resultado. Se `policy.state` for `disabled` ou `invalid`, ou o primário não puder ser resolvido, a função retorna `null` imediatamente, sem chamar rede — o chamador degrada para o fallback nutricional canônico/local já existente.

- Fonte insuficiente: o prompt instrui o provider a retornar `found=false` quando houver dúvida sobre SKU, sabor, peso ou marca. `parseSearchedNutritionResult` exige `webSearch.executed=true`, `evidence` não vazia e fonte vinculada pelo provider. OpenAI pode validar a URL citada diretamente; Gemini pode fornecer URI opaca de redirecionamento, então o adapter normaliza `groundingSupports` e associa os segmentos sustentados aos respectivos `groundingChunks`. Uma URL escrita pelo modelo que não aparece nas citações não é confiável; quando a URI é opaca, a evidência precisa estar ligada ao chunk pelo grounding. O texto livre de uma chamada adicional de recuperação nunca é convertido em `supportingText`: somente segmentos ligados nativamente a `url_citation` ou `groundingSupports` estabelecem procedência. URLs sem esse vínculo permanecem insuficientes e degradam para o fallback canônico.
- Identidade comercial: antes de aceitar o candidato, a busca compara termos significativos, qualificadores e medidas nas duas direções. Termo de sabor/SKU ou medida presente apenas no candidato torna a entrada genérica ambígua e retorna `null`; portanto `Trento` não pode selecionar silenciosamente `Trento Chocolate Branco Dark 32 g`. O texto consultado só vira alias depois da validação. Divergência ou informação comercial não identificada retorna `null` mesmo com confiança alta e fonte válida; o guard semântico compartilhado ainda é aplicado em seguida.

- Compatibilidade Gemini: `QUESTION` pode usar Gemini 2.5 com Google Search. `NUTRITION_SEARCH` combina Google Search e Structured Output na mesma chamada e, por isso, requer modelo Gemini 3 explicitamente configurado. `gemini-2.5-flash` é recusado pelo resolvedor antes da rede; a #927 preservou OpenAI como default por falta de comparação live suficiente.
- JSON inválido ou payload estruturalmente inválido é rejeitado dentro da callback entregue a `executeResolvedCapability`, portanto segue a taxonomia operacional comum e pode consumir retry/fallback único quando explicitamente habilitado. Já `found=false`, confiança insuficiente, fonte ausente/não citada, evidência vazia ou identidade comercial incompatível são resultados funcionais processados depois do executor: retornam `null` e degradam diretamente para o caminho canônico, sem nova consulta externa. Exceções finais são capturadas e também viram `null` para não derrubar o chamador.
- `null` em qualquer um desses casos faz o chamador (`findCatalogFoodSemantic`) seguir para o próximo candidato/fallback canônico do motor nutricional, sem inventar dado e sem bloquear a inferência de refeição.

A busca semântica de catálogo usa a capacidade `EMBEDDING` (default OpenAI `text-embedding-3-small`) para gerar o vetor da consulta e comparar por similaridade de cosseno com o catálogo pré-embebido. O cache registra o provider/modelo efetivamente usado pelo executor; se a consulta vier de outro modelo efetivo, o cache é invalidado e a chamada degrada para a busca textual/canônica, sem comparar espaços vetoriais diferentes. Quando `EMBEDDING` está `disabled`/`invalid`, a busca semântica é pulada sem chamar rede — mesma política de "nunca substituir geração de texto por embeddings ausentes" coberta em `catalogSemanticSearch.test.ts`.
