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

- `interactionId` estável da interação;
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

Esse contrato é consumível pela #858 sem reimplementar a regra alimentar. A #858 decide genericamente o componente de transporte; a #855 continua dona da detecção, da compatibilidade da resposta e do efeito de domínio.

## Contagem e porção canônica

Uma contagem vira unidade somente quando o candidato é exato e possui porção estável:

- porções como `1 unidade`, `1 fatia`, `1 xícara` ou equivalente são aceitas;
- produto exato de marca com embalagem fixa em massa/volume pode ser aceito;
- referência `100 g` é apenas base nutricional e nunca representa implicitamente uma unidade;
- candidato aproximado ou produto semelhante nunca fornece porção para o alimento original.

Quando não existe porção segura, o sistema preserva o alimento e pergunta apenas peso, volume ou tamanho. Exemplo: `1 iogurte natural desnatado` sem produto/porção exatos cria pendência aberta e pede `170 g`, `200 ml` ou equivalente.

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
- resposta incompatível reapresenta a mesma pergunta e não consome a pendência;
- novo comando completo marca a pendência anterior como `superseded` e volta ao roteador central;
- exclusão completa sempre mantém a precedência da #856;
- claim compare-and-set impede clique, callback ou confirmação repetidos;
- usuário, estado, expiração e versão são revalidados pelo repositório;
- falha após claim recria a pendência com o texto original, sem persistir item parcial;
- após sucesso, a refeição é criada/atualizada pelos serviços canônicos, consolidada e recarregada antes da resposta.

## Bloqueio em profundidade

`standaloneCommandWords.ts` centraliza comandos inteiros como `registrar`, `confirmar`, `cancelar`, `editar`, `consultar`, `sim`, `não`, `ok` e número isolado.

As barreiras são:

1. resolvedor persistente antes dos parsers e do fallback;
2. schema estruturado rejeita `foodName` igual a comando isolado;
3. frases completas como `registrar 100 g de arroz` permanecem válidas;
4. nenhuma palavra de continuidade é usada no lugar do alimento original.

## Matriz mínima de regressão

- `2 bananas` com porção exata registra duas unidades;
- `3 ovos cozidos` com porção exata registra três unidades;
- iogurte exato com embalagem estável registra a porção canônica;
- iogurte genérico pede peso/tamanho sem assumir `100 g`;
- `1 iogurte natual desnatado` preserva original e normaliza o candidato;
- `170 g` conclui pendência aberta;
- `registrar` não conclui pendência de quantidade;
- `registrar` confirma somente pendência fechada compatível;
- exclusão durante pendência segue o gate destrutivo;
- comando isolado sem pendência não chama IA nem persistência;
- frase operacional completa segue o roteador;
- `foodName: Registrar` é rejeitado pelo schema;
- reentrega, expiração, cancelamento, callback repetido e isolamento entre usuários são fail-closed.
