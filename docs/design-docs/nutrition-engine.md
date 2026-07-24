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

## Compatibilidade semântica de variantes

- Todo candidato final deve passar pelo mesmo guard semântico, independentemente de vir do catálogo estático ou persistido, alias pessoal, TACO, busca semântica, busca web ou fluxo do WhatsApp.
- O nome canônico tem precedência sobre aliases. Um alias genérico não pode neutralizar qualificadores críticos do nome canônico.
- Variantes contraditórias não são equivalentes: `com açúcar`, `adoçado`, `sem açúcar`, `puro`, `com leite`, `com mel`, `com creme` e `com leite condensado` devem permanecer semanticamente distintas.
- Referências qualificadas como `Café sem açúcar` não podem ser usadas para `café`, `café com açúcar` ou qualquer preparação com complemento calórico.
- Fuzzy matching e aliases aprendidos não podem remover, inverter ou inventar qualificadores nutricionais.
- Quantidades e unidades de porção, como `1 xícara`, participam do cálculo, mas não impedem a identificação lexical do alimento.

## Componentes calóricos sem quantidade

- Quando a preparação contém açúcar e a quantidade está explícita, o motor incorpora o açúcar uma única vez aos macros e calorias do café.
- Quando uma estimativa utilizável da IA já representa a preparação adoçada, essa estimativa pode ser preservada, desde que passe pelo guard semântico.
- Quando a quantidade do açúcar não está explícita e não há estimativa utilizável, o motor retorna `food_component_quantity_required`; não deve cair em uma estimativa genérica nem persistir alimento antes da resposta.
- O WhatsApp transforma esse erro em `food_clarification.quantity`, preservando texto original, correlação inbound e operação pendente de registro, adição ou substituição.

## Pontos de atenção para agentes

- Antes de alterar confirmação de refeição, conferir impactos em dashboard, relatórios, favoritos e hábitos.
- Antes de alterar cálculo nutricional, adicionar teste de regressão.
- Antes de alterar prompts ou parsing de IA, revisar `docs/PRIVACY_LGPD.md`.
