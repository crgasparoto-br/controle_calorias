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

## Pontos de atenção para agentes

- Antes de alterar confirmação de refeição, conferir impactos em dashboard, relatórios, favoritos e hábitos.
- Antes de alterar cálculo nutricional, adicionar teste de regressão.
- Antes de alterar prompts ou parsing de IA, revisar `docs/PRIVACY_LGPD.md`.
