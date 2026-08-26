# Clarificação persistente de registro alimentar no WhatsApp

Issue: #855  
Épica coordenadora: #857  
Consumidores do contrato: #858 e #860

## Objetivo

Preservar a mensagem alimentar original quando o registro depende de confirmação, quantidade ou seleção. Uma resposta curta só pode resolver uma pendência compatível; sem pendência, palavras operacionais e números isolados nunca entram no pipeline nutricional.

A clarificação de quantidade é o último recurso quando o domínio não consegue resolver nem estimar a quantidade com base suficiente. Sempre que houver porção canônica, referência exata ou média usual contextual defensável, o sistema deve concluir o registro sem interromper o usuário e informar quando tiver usado estimativa.

## Ordem de precedência

1. idempotência e segurança do inbound;
2. callback interativo;
3. pergunta iniciada por `/`;
4. resposta curta ou novo comando destrutivo completo (#856);
5. resolução/criação da clarificação alimentar da #855;
6. demais intents e fallback nutricional.

`messageRouter.ts`, `executeWhatsappTextIntent` e `simulateWhatsappInbound` usam `foodClarification.ts`. Assim o webhook textual, áudio transcrito e simulador compartilham o mesmo estado persistente em `whatsappPendingOperations`.

## Contrato persistido

O tipo `food_registration_clarification` armazena um `PendingFoodClarificationTarget` versionado com:

- `interactionId` estável da interação, preservado em transições de tipo e recuperação segura;
- classificação `open` ou `closed`;
- tipo `quantity`, `confirmation` ou `selection`;
- texto original e texto sanitizado separados;
- candidato original e candidato normalizado separados;
- indicador de normalização ortográfica;
- contagem e qualificadores reconhecidos;
- candidatos, opção selecionada e porção de referência;
- ações canônicas, ordem, rótulos e efeito permitido;
- instrução textual equivalente;
- `messageId` do inbound quando disponível;
- único efeito autorizado: registrar uma vez o alimento original resolvido.

Uma nova linha em `whatsappPendingOperations` pode ser criada ao mudar de seleção para quantidade ou ao restaurar uma falha anterior à mutação, mas ela mantém o mesmo `interactionId`. O identificador só muda quando começa uma nova interação alimentar.

Esse contrato é consumível pela #858 sem reimplementar a regra alimentar. A #858 decide genericamente o componente de transporte; a #855 continua dona da detecção, da compatibilidade da resposta e do efeito de domínio.

## Contagem, porção canônica e média usual

Uma contagem pode virar gramas sem perguntar ao usuário quando existir base suficiente para resolver ou estimar a medida:

- porções canônicas como `1 unidade`, `1 fatia`, `1 xícara` ou equivalente são aceitas;
- porções canônicas multiunidade, como `2 fatias`, preservam o multiplicador e são encaminhadas ao domínio pelo peso canônico total, evitando perda de proporcionalidade nutricional;
- produto exato de marca com embalagem fixa em massa/volume pode ser aceito;
- referência `100 g` é apenas base nutricional e nunca representa implicitamente uma unidade;
- depois da porção local, uma referência exata e verificável da mesma medida para o mesmo alimento/produto pode resolver a quantidade;
- se não houver referência exata, uma média usual contextual e defensável da mesma medida para o mesmo alimento/tipo/preparo pode resolver a quantidade como **estimativa**;
- candidato aproximado ou produto semelhante não pode ser apresentado como porção exata do alimento original.

Exemplo: uma porção canônica de `Pão integral Wickbold` equivale a `2 fatias` e `50 g`. Portanto, `1 pão integral Wickbold` registra `50 g` e `2 pão integral Wickbold` registra `100 g`, equivalentes a duas e quatro fatias, com peso e nutrientes proporcionais definidos pelo domínio.

Exemplo de estimativa: se `1 fatia de presunto` não possuir porção exata local, mas o domínio tiver base compatível suficiente para estabelecer uma fatia usual de aproximadamente `X g`, a operação pode ser registrada com `X g`, marcada como estimada e apresentada ao usuário como valor aproximado. Não deve abrir clarificação apenas porque a porção não estava persistida em `food_portions`.

A média usual não é uma constante universal da unidade. `1 fatia de presunto`, `1 fatia de mussarela` e `1 fatia de pão` podem produzir gramaturas diferentes. Para produtos com marca, uma média usual de alimento/tipo compatível pode estimar a quantidade sem transformar outra marca em correspondência exata do produto.

A precedência para quantidade contável é:

```text
massa/volume explícitos
-> food_portions/porção canônica local
-> referência exata verificável da medida
-> média usual contextual defensável
-> clarificação persistente
```

Somente quando nenhuma dessas fontes resolver ou estimar a quantidade com segurança suficiente o sistema preserva o alimento e pergunta peso, volume ou tamanho. Uma descrição estruturalmente ambígua como `1 porção de lasanha`, sem base útil para uma porção usual, ainda pode gerar pendência aberta.

Um candidato único sem quantidade resolvida não substitui o candidato normalizado preservado. Quando o usuário escolhe explicitamente uma opção entre múltiplos candidatos, essa opção passa a ser a identidade usada para resolução de quantidade e persistência final.

## Estimativa transparente e correção posterior

Uma estimativa média usual aceita não exige confirmação prévia. Ela deve ser registrada com procedência suficiente para distinguir, conceitualmente, entre:

- porção exata/canônica;
- medida exata pesquisada;
- média usual estimada;
- clarificação necessária.

A resposta do WhatsApp deve deixar claro quando a gramatura é aproximada e que os nutrientes foram calculados com essa estimativa. Exemplo conceitual:

```text
Presunto — 1 fatia (aprox. 18 g)
Estimativa baseada na medida média usual para fatia de presunto.
```

O usuário pode corrigir posteriormente pelo fluxo canônico de ajuste no WhatsApp ou pela tela de ajuste da refeição. A correção não deve criar um mecanismo paralelo de persistência.

## Café com açúcar sem quantidade explícita

`café com açúcar` é um caso em que a ausência da quantidade do complemento não deve provocar clarificação automaticamente quando a preparação é simples e o domínio possui uma média operacional canônica.

Regras:

- quantidade explícita de açúcar sempre vence qualquer média;
- para `café com açúcar` simples, sem leite, mel, creme, leite condensado ou outro complemento calórico, a média operacional inicial é **5 g de açúcar por xícara canônica de 200 ml**;
- a quantidade média de açúcar escala proporcionalmente ao volume ou ao número de xícaras reconhecido;
- se o usuário não informar volume, a referência continua sendo uma xícara canônica de `200 ml`;
- usando a referência canônica atual de café sem açúcar (`200 ml = 2 kcal`) e `4 kcal/g` para açúcar, uma xícara estimada de café com açúcar corresponde a aproximadamente `22 kcal` e `5 g` de carboidratos;
- a resposta deve informar que a quantidade de açúcar foi estimada pela média operacional e permitir correção posterior;
- `food_component_quantity_required` não deve ser usado para o caso simples acima apenas porque o usuário omitiu os gramas de açúcar;
- preparações com outros complementos calóricos devem preservar a preparação completa; se não houver estimativa coerente da combinação, a clarificação ainda pode ser necessária.

Exemplo conceitual:

```text
Café com açúcar — 1 xícara (200 ml)
≈ 22 kcal | açúcar estimado: 5 g
Usei a média de açúcar para o cálculo. Se quiser, você pode ajustar depois pelo WhatsApp ou na tela da refeição.
```

A média de `5 g/200 ml` é uma **regra operacional do produto**, não uma afirmação de que todo usuário adoça o café dessa forma. Ela deve existir em fonte canônica única no domínio, sem ser duplicada em handlers do WhatsApp.

## Normalização conservadora

Erros ortográficos simples conhecidos, como `natual` → `natural`, são aplicados somente ao candidato normalizado. O texto original permanece imutável para auditoria e reexecução.

- um candidato exato e seguro após normalização gera confirmação específica;
- múltiplos candidatos seguros geram seleção;
- ausência de porção local, por si só, não gera pergunta: o domínio tenta referência exata e média usual antes de clarificar;
- ausência de quantidade resolvível ou estimável gera pergunta aberta de quantidade;
- nunca ocorre correção silenciosa quando a resolução de identidade ainda é ambígua.

## Resolução e segurança

- `confirmation` aceita confirmação/cancelamento compatíveis;
- `quantity` aceita somente uma resposta formada apenas por número e unidade;
- `selection` aceita somente opção válida/callback correspondente;
- pontuação de apresentação no início ou no fim, como `registrar!`, `cancelar.` e `170 g.`, é normalizada antes da compatibilidade;
- resposta incompatível reapresenta a mesma pergunta e não consome a pendência;
- novo comando completo marca a pendência anterior como `superseded` e volta ao roteador central;
- a decisão de que uma descrição alimentar livre é uma nova refeição reutiliza o roteador canônico, evitando uma lista paralela de frases válidas;
- mensagens alimentares livres, como `arroz com frango`, `jantar: arroz e frango` e `pão com queijo e café`, substituem a pendência anterior e seguem o pipeline normal;
- uma nova refeição completa, como `200 g de frango` ou `1 banana`, não precisa conter verbo operacional para substituir a pendência anterior;
- exclusão completa sempre mantém a precedência da #856;
- claim compare-and-set impede clique, callback ou confirmação repetidos;
- usuário, estado, expiração e versão são revalidados pelo repositório;
- falha comprovadamente anterior à mutação restaura a pendência com o mesmo texto e `interactionId`;
- falha após possível mutação bloqueia retry automático para evitar duplicidade;
- após sucesso, a refeição é criada/atualizada pelos serviços canônicos, consolidada e recarregada antes da resposta.

## Bloqueio em profundidade

`standaloneCommandWords.ts` centraliza comandos inteiros como `registrar`, `confirmar`, `cancelar`, `editar`, `consultar`, `sim`, `não`, `ok`, quantidade e número isolado. A comparação remove acentos, espaços excedentes e pontuação periférica, sem transformar uma frase completa em comando isolado.

As barreiras são:

1. resolvedor persistente antes dos parsers e do fallback;
2. schema estruturado rejeita `foodName` igual a comando isolado;
3. frases completas como `registrar 100 g de arroz` permanecem válidas;
4. nenhuma palavra de continuidade é usada no lugar do alimento original.

## Matriz mínima de regressão

- `2 bananas` com porção exata registra duas unidades;
- `3 ovos cozidos` com porção exata registra três unidades;
- `1 pão integral Wickbold` com porção canônica de `2 fatias / 50 g` registra `50 g`;
- `2 pão integral Wickbold` com a mesma porção registra `100 g` e nutrientes proporcionais;
- iogurte exato com embalagem estável registra a porção canônica;
- medida sem porção local, mas com média usual defensável, registra com gramatura aproximada e informa a estimativa sem abrir pendência;
- medida sem porção local, referência exata nem média usual defensável pede peso/tamanho sem assumir `1 g` ou `100 g`;
- `1 fatia de presunto` e `1 fatia de mussarela` podem usar médias usuais diferentes;
- `1 iogurte natual desnatado` preserva original e normaliza o candidato;
- seleção de candidato sem quantidade segura mantém a opção escolhida ao receber o peso;
- `170 g` e `170 g.` concluem pendência aberta;
- `registrar` não conclui pendência de quantidade;
- `registrar` confirma somente pendência fechada compatível;
- `cancelar.` cancela sem persistir;
- exclusão durante pendência segue o gate destrutivo;
- comando isolado, com ou sem pontuação, não chama IA nem persistência;
- `200 g de frango` e `1 banana` seguem o roteador como novas mensagens completas;
- `arroz com frango`, `jantar: arroz e frango` e `pão com queijo e café` substituem a pendência e alcançam o parser/fallback canônico uma única vez;
- `1 xícara de café com açúcar`, sem quantidade explícita de açúcar, registra aproximadamente `22 kcal` usando `5 g` de açúcar estimados e informa a estimativa;
- `200 ml de café com 8 g de açúcar` usa os `8 g` explícitos, nunca a média de `5 g`;
- café com açúcar e leite não pode ser reduzido ao caso simples de `5 g` de açúcar com demais macros zerados;
- frase operacional completa segue o roteador;
- `foodName: Registrar` é rejeitado pelo schema;
- reentrega, expiração, cancelamento, callback repetido e isolamento entre usuários são fail-closed;
- transições e retries seguros preservam o mesmo `interactionId`.

## Extensão: refeição textual e ajuste misto (#997 / #1016)

Medidas contáveis em uma refeição textual e ajustes heterogêneos reutilizam a mesma infraestrutura persistente. O estado lógico do ajuste composto é `parsed -> awaiting_selection|awaiting_quantity -> ready_to_apply -> applied`, com `cancelled|expired|superseded|stale` como terminais sem mutação.

O comando `Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela` é um único plano. `uma` herda `fatia` somente do segmento coordenado imediatamente anterior; sem antecedente inequívoco, a unidade fica sem resolução e exige clarificação.

Regras de atomicidade:

- nenhuma operação já resolvida é gravada enquanto outra operação do mesmo plano aguarda seleção ou quantidade;
- seleção reutiliza `meal_item_selection` e carrega a continuação do plano; quantidade reutiliza `food_registration_clarification` com `allowedDomainEffect = complete_pending_food_operation_once`;
- respostas incompatíveis não consomem a pendência; respostas válidas são claimadas por versão/CAS;
- o plano preserva texto original, operações, quantidades/unidades e alvos já resolvidos;
- antes da escrita final, refeição e identidade dos itens são recarregadas; alvo alterado torna o plano `stale` sem mutação;
- o lote final usa a mutação compensada de refeições e retries/callbacks repetidos não aplicam o plano novamente.

No registro textual, pão/café ou outra contagem com porção canônica segura pode ser convertida antes do pipeline nutricional. Quando não houver porção canônica, o domínio tenta referência exata e média usual contextual antes de abrir clarificação. Itens resolvidos por estimativa permanecem marcados como aproximados e não bloqueiam o comando. Apenas itens que continuem sem quantidade resolvível/estimável permanecem no contexto persistido até a resposta de peso/volume. A refeição somente é confirmada depois que todas as quantidades realmente pendentes forem resolvidas.
