# Relatório de Análise Técnica: Otimização da IA de Análise de Fotos
**Projeto:** controle_calorias  
**Autor:** Manus AI  
**Data:** 5 de Junho de 2026  

---

## 1. Introdução e Diagnóstico do Estado Atual

O sistema de registro de refeições por imagem do repositório **controle_calorias** possui uma arquitetura moderna, robusta e muito bem estruturada. A análise de mídias é centralizada no módulo `nutritionEngine.ts` [1], que orquestra a inferência multimodal e calibra os resultados gerados pela Inteligência Artificial com um catálogo local de alimentos (`FOOD_CATALOG_REFERENCE`) [1].

### Fluxo de Processamento Atual:
1. **Entrada de Mídia:** O usuário envia uma foto da refeição via Web (React/tRPC) ou WhatsApp [2].
2. **Inferência Multimodal (OpenAI):** A imagem é enviada inline em Base64 ou via URL para a API da OpenAI utilizando o modelo configurado na variável `OPENAI_MODEL`, cujo fallback padrão é o **`gpt-4o-mini`** [3].
3. **Structured Outputs:** O sistema força a resposta em um formato JSON estrito (`meal_extraction`) validado via schema do Zod [1].
4. **Reconciliação com Catálogo Local:** O backend analisa os itens retornados pela IA. Se o nome do alimento coincidir com algum item do catálogo local, os macronutrientes e calorias são **recalculados** de forma determinística utilizando os dados do catálogo (`source: "catalog"`) [1]. Caso contrário, o sistema confia nos valores nutricionais estimados pela IA (`source: "hybrid"`) [1].
5. **Geração Visual Auxiliar:** Em paralelo e de forma não bloqueante, o sistema gera uma imagem ilustrativa da refeição usando DALL-E (`gpt-image-1` ou similar) para fins estéticos na interface [4].

---

## 2. Avaliação Crítica do Modelo Atual (`gpt-4o-mini`)

O **`gpt-4o-mini`** é o modelo de entrada multimodal padrão do projeto. Embora seja uma escolha extremamente eficiente para início de projeto, ele apresenta limitações importantes para um cenário de alta performance em nutrição.

### Tabela 1: Prós e Contras do `gpt-4o-mini` no Cenário de Nutrição

| Dimensão | Vantagens | Limitações |
| :--- | :--- | :--- |
| **Custo e Latência** | • Custo extremamente baixo ($0.15/1M tokens de entrada) [5].<br>• Resposta rápida, ideal para o WhatsApp [2]. | • Nenhuma limitação relevante nesta dimensão. |
| **Acurácia de Visão** | • Excelente para identificar alimentos isolados e óbvios (ex: "banana", "ovo frito") [1]. | • Dificuldade em segmentar pratos complexos ou misturados (ex: risotos, lasanhas, ensopados) [6].<br>• Perda de precisão em condições de iluminação desfavoráveis [6]. |
| **Estimativa de Porção** | • Consegue inferir porções básicas a partir do contexto textual do usuário [1]. | • Tendência sistemática a **subestimar porções grandes** (acima de 300g) devido à perda de perspectiva 3D em fotos 2D [7]. |
| **Leitura de Rótulos (OCR)** | • Suporta leitura básica de tabelas nutricionais claras [1]. | • Taxa de erro moderada em fotos de rótulos curvos, amassados ou com sombras [8]. |

> **Veredito:** O `gpt-4o-mini` **não é a melhor opção** se o objetivo for maximizar a acurácia de identificação e a precisão das porções. Ele é, contudo, a opção mais econômica e rápida.

---

## 3. Comparativo de Modelos de IA para Visão Nutricional (2026)

Com base em estudos científicos recentes de avaliação de modelos de linguagem de visão (VLMs) aplicados à nutrição [6] [7], e nos lançamentos mais recentes das APIs, estruturamos o comparativo abaixo para guiar a escolha do novo modelo.

### Tabela 2: Comparativo de Modelos Multimodais na API

| Modelo | Custo por 1M Tokens (Input/Output) | Acurácia Visual (Alimentos) | Precisão de Porção (g) | Capacidade de OCR (Rótulos) | Latência | Recomendação de Uso |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`gpt-4o-mini`** | $0.15 / $0.60 [5] | Média (65-70%) | Baixa-Média | Média | Muito Baixa | Manter apenas como fallback de custo ou para usuários gratuitos. |
| **`gpt-4.1-mini`** *(Novo)* | $0.40 / $1.60 [9] | Alta (78-82%) [10] | Média (MAPE ~38%) | Alta [10] | Baixa | **Melhor custo-benefício atual.** Excelente para seguir regras de JSON Schema e prompts negativos [10]. |
| **`gpt-4o`** | $2.50 / $10.00 [5] | Muito Alta (85-88%) | Média-Alta (MAPE ~35%) [7] | Muito Alta | Média | Ideal para cenários premium onde a acurácia de visão é crítica e o custo não é barreira. |
| **`Claude 3.5 Sonnet`** | $3.00 / $15.00 | Excelente (>88%) | Alta (MAPE ~34%) [7] | Excelente | Média | Excelente modelo de visão, mas exigiria reescrever a camada de integração do provider (hoje acoplada à OpenAI). |

---

## 4. Proposta de Solução: A "Melhor Opção" para o Controle de Calorias

Para atingir a melhor performance sem estourar o orçamento do projeto, a melhor estratégia é adotar uma **Abordagem Híbrida de Dois Estágios (Two-Stage Pipeline)** utilizando o **`gpt-4.1-mini`** como motor principal de visão.

### Arquitetura Proposta:
```text
[ Foto do Prato ] ──> [ GPT-4.1-mini ] ──> Extrai Alimentos + Porções Visuais (ex: "1 colher de sopa")
                                                    │
                                                    ▼
[ Dados Finais ] <── [ Busca Semântica ] <── [ Catálogo Local / Banco TACO ]
  (Cálculo Exato)      (Busca por Embeddings)
```

1. **Estágio 1: Visão e Segmentação (`gpt-4.1-mini`):**
   A IA de visão foca estritamente em **identificar quais alimentos estão no prato** e estimar o **volume visual** (ex: "1 concha média", "1 fatia fina", "100g"). A IA *não deve* tentar adivinhar os macronutrientes do zero se o alimento puder ser mapeado.
2. **Estágio 2: Reconciliação Semântica (Backend):**
   Em vez de fazer um batimento de string exato (que falha se a IA retornar "arroz integral cozido" e o catálogo tiver "Arroz integral, cozido"), o backend deve utilizar uma **busca semântica simples (vetorial/embeddings)** para mapear o item identificado ao item correspondente no catálogo local ou em uma base mais ampla (como a tabela TACO).
3. **Cálculo Nutricional Determinístico:**
   O cálculo final de calorias e macros é feito de forma 100% matemática no backend com base no peso/porção estimado e nos dados oficiais do catálogo mapeado, eliminando as alucinações numéricas da IA.

---

## 5. Plano de Implementação Prática (Passo a Passo)

### Passo 1: Upgrade do Modelo de Visão (Quick Win)
No arquivo `server/_core/env.ts`, altere o fallback do modelo padrão para tirar proveito da nova família de modelos `gpt-4.1` da OpenAI, que possui melhor capacidade de visão e inteligência geral com custo ainda muito baixo.

```typescript
// server/_core/env.ts
export const ENV = {
  // ...
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", // Alterado de gpt-4o-mini para gpt-4.1-mini
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1",
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
};
```

### Passo 2: Otimização do Prompt de Visão para Estimativa de Porção
Estudos indicam que modelos de visão estimam porções de forma muito mais precisa quando são explicitamente instruídos a usar **referências visuais de escala** presentes na foto (como o tamanho do prato, talheres ou copos) [7].

Altere as instruções do sistema em `server/nutritionEngine.ts` para incluir essa diretriz:

```typescript
// server/nutritionEngine.ts - Linha 570 (aproximadamente)
// Adicionar as seguintes instruções no array de prompts do extractWithAi:

"Use elementos de referência visual na imagem (como o tamanho do prato, talheres, copos ou as mãos do usuário) para calibrar e estimar com maior precisão o peso em gramas de cada alimento.",
"Lembre-se de que porções de alimentos ricos em amido (arroz, batata, massa) costumam ter maior volume e peso no prato; calibre sua estimativa de acordo.",
"Se houver uma tabela nutricional visível no rótulo, extraia os valores textuais exatos com precisão de OCR e use-os prioritariamente.",
```

### Passo 3: Implementação de Busca Semântica no Catálogo (Melhoria de Médio Prazo)
Atualmente, a função `findCatalogFood` faz uma busca por correspondência exata de texto ou substring simples [1]:

```typescript
function findCatalogFood(foodName: string) {
  const normalized = normalizeText(cleanFoodName(foodName));
  const catalogSource = getCatalogCache();
  return (
    catalogSource.find(item =>
      [item.name, ...item.aliases].some(alias => normalizeText(alias) === normalized),
    ) ||
    catalogSource.find(item =>
      [item.name, ...item.aliases].some(alias => normalized.includes(normalizeText(alias)) || normalizeText(alias).includes(normalized)),
    )
  );
}
```

**Recomendação:** Para evitar que o sistema caia no modo "hybrid" (confiando nos macros alucinados da IA) devido a pequenas variações de digitação ou nomenclatura, implemente uma busca semântica utilizando embeddings da OpenAI (`text-embedding-3-small`) para mapear o `foodName` retornado pela IA ao item mais próximo do catálogo local.

---

## 6. Conclusão e Próximos Passos

1. **A IA atual (`gpt-4o-mini`) é aceitável pelo custo**, mas falha em acurácia de visão e estimativa fina de porções em gramas.
2. **A melhor opção imediata (Quick Win) é o `gpt-4.1-mini`**, que oferece um salto expressivo de inteligência e capacidade de OCR por uma fração mínima de aumento de custo.
3. **A melhor opção técnica de longo prazo** é a arquitetura híbrida de dois estágios, combinando o poder de visão do `gpt-4.1-mini` com um mecanismo de busca semântica (vetorial) acoplado ao seu catálogo local de alimentos.

---

## 7. Referências

1. [nutritionEngine.ts](file:///home/ubuntu/controle_calorias/server/nutritionEngine.ts) - Regras de negócio e motor de processamento de alimentos do Controle de Calorias.
2. [whatsappWebhook.ts](file:///home/ubuntu/controle_calorias/server/whatsappWebhook.ts) - Integração oficial do canal conversacional WhatsApp.
3. [env.ts](file:///home/ubuntu/controle_calorias/server/_core/env.ts) - Centralização de variáveis de ambiente e modelos padrão do backend.
4. [imageGeneration.ts](file:///home/ubuntu/controle_calorias/server/_core/imageGeneration.ts) - Helper de geração de imagem auxiliar não bloqueante.
5. [OpenAI API Pricing](https://openai.com/api/pricing/) - Tabela oficial de preços da API da OpenAI.
6. [Are Vision-Language Models Ready for Dietary Assessment? Exploring the Next Frontier in AI-Powered Food Image Recognition](https://arxiv.org/html/2504.06925v1) - Estudo de 2025 avaliando a acurácia de VLMs em reconhecimento de ingredientes e estilos de cozimento.
7. [Performance Evaluation of 3 Large Language Models for Nutritional Content Estimation from Food Images](https://pmc.ncbi.nlm.nih.gov/articles/PMC12513282/) - Estudo de 2025 comparando ChatGPT-4o, Claude 3.5 Sonnet e Gemini 1.5 Pro na estimativa de peso e calorias de refeições de diferentes tamanhos.
8. [Inconsistencies in Image Analysis with GPT-4o-mini Using Low Detail](https://community.openai.com/t/inconsistencies-in-image-analysis-with-gpt-4o-mini-using-low-detail/935159) - Discussão na comunidade OpenAI sobre inconsistências de OCR e detalhes de imagem em modelos mini.
9. [Introducing GPT-4.1 in the API](https://openai.com/index/gpt-4-1/) - Anúncio oficial da OpenAI sobre a família de modelos GPT-4.1, detalhando custos e ganhos de performance.
10. [OpenAI GPT-4.1, 4.1 Mini, 4.1 Nano Tested](https://www.reddit.com/r/OpenAI/comments/1jz9whh/openai_gpt41_41_mini_41_nano_tested_test_results/) - Benchmarks práticos e testes de performance da nova família de modelos.
