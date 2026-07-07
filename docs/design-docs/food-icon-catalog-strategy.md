# Estratégia de ícones de alimentos no WhatsApp

## Contexto

As respostas do WhatsApp exibem alimentos com um ícone visual antes do nome, por exemplo:

```text
• 🍌 Banana prata — 139g
125 kcal | P 1,5 g | C 32,3 g | G 0,4 g
```

A lógica atual usa um helper determinístico em `server/modules/whatsapp/foodIcons.ts`. Esse helper considera primeiro palavras-chave do alimento e, quando disponíveis, metadados opcionais como categoria, classificação ou tags. O fallback continua sendo `🍽️`.

## Decisão

Não vamos adicionar, neste momento, um campo obrigatório de ícone no schema do catálogo de alimentos.

A decisão é manter a atribuição de ícones como uma responsabilidade do helper determinístico, com suporte progressivo a metadados opcionais. Isso evita migração de banco prematura, preserva compatibilidade com registros antigos e mantém a experiência do WhatsApp estável mesmo quando um alimento não tem ícone específico configurado.

## Prioridade de resolução

A prioridade recomendada para resolver o ícone de um alimento é:

1. Ícone explícito configurado no catálogo, se esse campo for criado no futuro.
2. Ícone por categoria ou classificação nutricional, quando disponível.
3. Regra textual determinística por `foodName` e `canonicalName`.
4. Fallback visual `🍽️`.

Enquanto não houver campo explícito no catálogo, o fluxo efetivo permanece:

1. Regra textual determinística por `foodName` e `canonicalName`.
2. Categoria, classificação ou tags opcionais.
3. Fallback visual `🍽️`.

## Motivos

- Ícone é detalhe de apresentação, não dado nutricional essencial.
- Tornar o ícone obrigatório aumentaria o custo de cadastro e manutenção do catálogo.
- Registros antigos e alimentos vindos da IA, heurística ou integrações podem não ter metadados completos.
- A regra precisa continuar previsível, auditável e independente da IA.
- O WhatsApp precisa responder bem mesmo quando há baixa confiança ou alimento desconhecido.

## Quando considerar campo no catálogo

Um campo `icon` ou `categoryIcon` pode ser avaliado futuramente se pelo menos uma das condições abaixo se tornar recorrente:

- muitos alimentos importantes continuam caindo no fallback `🍽️` mesmo após regras por categoria;
- houver tela administrativa de catálogo com curadoria manual de alimentos;
- o mesmo alimento aparecer com variações textuais difíceis de cobrir com regras determinísticas;
- a web também passar a exibir ícones de alimentos e precisar da mesma fonte visual;
- houver necessidade de diferenciar marcas/produtos específicos.

## Requisitos para uma implementação futura

Se o campo de ícone for implementado no catálogo, a solução deve seguir estes requisitos:

- o campo deve ser opcional;
- alimentos antigos sem ícone devem continuar funcionando;
- o fallback `🍽️` deve permanecer;
- a resolução deve continuar determinística;
- o valor salvo deve ser validado para evitar texto arbitrário longo;
- o helper `resolveFoodIcon` deve continuar sendo o ponto único de decisão;
- a IA não deve ser a única fonte de escolha do ícone.

## Modelo sugerido futuro

Exemplo de evolução segura, caso necessária:

```ts
type CatalogFoodIconMetadata = {
  icon?: string | null;
  categoryIcon?: string | null;
};
```

A prioridade futura ficaria:

```text
catalog.icon -> catalog.categoryIcon -> category/classification/tags -> foodName/canonicalName -> 🍽️
```

## Escopo fora desta decisão

Esta decisão não altera:

- schema do banco;
- migrations;
- tela de administração do catálogo;
- fluxo de cadastro de alimento;
- resposta da IA;
- cálculo nutricional.

## Relação com issues

- Implementa a decisão técnica da #671.
- Complementa a evolução de cobertura da #670.
- Mantém a épica #668 sem dependência obrigatória de alteração de banco.
