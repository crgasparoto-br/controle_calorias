# Clarificação persistente de registro alimentar no WhatsApp

Issue: #855  
Épica coordenadora: #857  
Consumidores do contrato: #858 e #860

## Objetivo

Preservar a mensagem alimentar original quando o registro depende de confirmação, quantidade ou seleção. Uma resposta curta só pode resolver uma pendência compatível; sem pendência, palavras operacionais e números isolados nunca entram no pipeline nutricional.

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

## Contagem e porção canônica

Uma contagem vira unidade somente quando o candidato é exato e possui porção estável:

- porções como `1 unidade`, `1 fatia`, `1 xícara` ou equivalente são aceitas;
- porções canônicas multiunidade, como `2 fatias`, preservam o multiplicador: a quantidade final é a contagem informada multiplicada pela quantidade da porção canônica;
- produto exato de marca com embalagem fixa em massa/volume pode ser aceito;
- referência `100 g` é apenas base nutricional e nunca representa implicitamente uma unidade;
- candidato aproximado ou produto semelhante nunca fornece porção para o alimento original.

Exemplo: uma porção canônica de `Pão integral Wickbold` equivale a `2 fatias`. Portanto, `1 pão integral Wickbold` registra `2 fatias`, e `2 pão integral Wickbold` registra `4 fatias`, mantendo o peso e os nutrientes proporcionais definidos pelo domínio.

Quando não existe porção segura, o sistema preserva o alimento e pergunta apenas peso, volume ou tamanho. Exemplo: `1 iogurte natural desnatado` sem produto/porção exatos cria pendência aberta e pede `170 g`, `200 ml` ou equivalente.

Um candidato único sem porção segura não substitui o candidato normalizado preservado. Quando o usuário escolhe explicitamente uma opção entre múltiplos candidatos, essa opção passa a ser a identidade usada na pergunta de quantidade e na persistência final.

## Normalização conservadora

Erros ortográficos simples conhecidos, como `natual` → `natural`, são aplicados somente ao candidato normalizado. O texto original permanece imutável para auditoria e reexecução.

- um candidato exato e seguro após normalização gera confirmação específica;
- múltiplos candidatos seguros geram seleção;
- ausência de porção segura gera pergunta aberta de quantidade;
- nunca ocorre correção silenciosa quando a resolução ainda é ambígua.

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
- `1 pão integral Wickbold` com porção canônica de `2 fatias` registra duas fatias;
- `2 pão integral Wickbold` com a mesma porção registra quatro fatias e nutrientes proporcionais;
- iogurte exato com embalagem estável registra a porção canônica;
- iogurte genérico pede peso/tamanho sem assumir `100 g`;
- `1 iogurte natual desnatado` preserva original e normaliza o candidato;
- seleção de candidato sem porção segura mantém a opção escolhida ao receber o peso;
- `170 g` e `170 g.` concluem pendência aberta;
- `registrar` não conclui pendência de quantidade;
- `registrar` confirma somente pendência fechada compatível;
- `cancelar.` cancela sem persistir;
- exclusão durante pendência segue o gate destrutivo;
- comando isolado, com ou sem pontuação, não chama IA nem persistência;
- `200 g de frango` e `1 banana` seguem o roteador como novas mensagens completas;
- `arroz com frango`, `jantar: arroz e frango` e `pão com queijo e café` substituem a pendência e alcançam o parser/fallback canônico uma única vez;
- frase operacional completa segue o roteador;
- `foodName: Registrar` é rejeitado pelo schema;
- reentrega, expiração, cancelamento, callback repetido e isolamento entre usuários são fail-closed;
- transições e retries seguros preservam o mesmo `interactionId`.
