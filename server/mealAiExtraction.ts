import { z } from "zod";
import { getAiProvider, type AiProviderTextRequest } from "./_core/aiProvider";
import { ENV } from "./_core/env";
import { inferMealLabelByTime } from "./mealLabelResolver";
import type { HabitSnapshot, MealProcessingInput } from "./nutritionEngineTypes";

type AiInputContentItem =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail: "high";
    };

const mealExtractionSchema = z.object({
  mealLabel: z.string().trim().min(1).max(80),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().trim().min(1).max(2000),
  items: z.array(z.object({
    foodName: z.string().trim().min(1).max(160),
    quantity: z.number().min(0.01).max(5000).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    portionText: z.string().trim().min(1).max(120),
    servings: z.number().min(0.1).max(20),
    estimatedGrams: z.number().min(0).max(5000),
    estimatedCalories: z.number().min(0).max(10000),
    estimatedMacros: z.object({
      protein: z.number().min(0).max(1000),
      carbs: z.number().min(0).max(1000),
      fat: z.number().min(0).max(1000),
    }),
    confidence: z.number().min(0).max(1),
  })),
});

const mealExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mealLabel: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasoning: { type: "string" },
    items: {
      type: "array",
      minItems: 0,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          foodName: { type: "string" },
          quantity: { type: "number", minimum: 0.01, maximum: 5000 },
          unit: { type: "string" },
          portionText: { type: "string" },
          servings: { type: "number", minimum: 0.1, maximum: 20 },
          estimatedGrams: { type: "number", minimum: 0, maximum: 5000 },
          estimatedCalories: { type: "number", minimum: 0, maximum: 10000 },
          estimatedMacros: {
            type: "object",
            additionalProperties: false,
            properties: {
              protein: { type: "number", minimum: 0, maximum: 1000 },
              carbs: { type: "number", minimum: 0, maximum: 1000 },
              fat: { type: "number", minimum: 0, maximum: 1000 },
            },
            required: ["protein", "carbs", "fat"],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: [
          "foodName",
          "quantity",
          "unit",
          "portionText",
          "servings",
          "estimatedGrams",
          "estimatedCalories",
          "estimatedMacros",
          "confidence"
        ],
      },
    },
  },
  required: ["mealLabel", "confidence", "reasoning", "items"],
} as const;

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function intentHintToPrompt(hint: import("./nutritionEngineTypes").IntentHint | null | undefined): string | null {
  if (!hint) return null;

  const lines: string[] = [
    `Intenção identificada pelo classificador: ${hint.intent} (confiança: ${(hint.confidence * 100).toFixed(0)}%)`,
  ];

  if (hint.mealLabel) {
    lines.push(`Tipo de refeição já resolvido: ${hint.mealLabel}`);
  }
  if (hint.date) {
    lines.push(`Data já resolvida: ${hint.date}`);
  }
  if (hint.reasoning) {
    lines.push(`Raciocínio do classificador: ${hint.reasoning}`);
  }

  lines.push(
    "Use esse contexto para focar a extração:",
    "- Se a intenção for 'add_foods_to_meal', extraia os alimentos mencionados para registro.",
    "- Se a intenção for 'nutrition_query' ou similar, retorne items vazio e explique no reasoning.",
    "- Se a confiança for baixa (< 60%), trate o contexto como sugestão, não como certeza.",
  );

  return lines.join("\n");
}

function habitsToPrompt(habits: HabitSnapshot[] = []) {
  if (!habits.length) {
    return "Sem histórico prévio relevante do usuário.";
  }

  return habits
    .slice(0, 8)
    .map(habit => `${habit.foodName} | frequência: ${habit.occurrenceCount} | horário típico: ${habit.typicalTimeLabel ?? "não informado"} | observações: ${habit.notes ?? "-"}`)
    .join("\n");
}

export async function extractWithAi(input: MealProcessingInput): Promise<z.infer<typeof mealExtractionSchema> | null> {
  const composedText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n");
  const suggestedMealLabel = input.suggestedMealLabel?.trim() || inferMealLabelByTime(input.occurredAt, input.timeZone);
  const content: AiInputContentItem[] = [
    {
      type: "input_text",
      text: [
        "Analise a refeição do usuário e extraia itens alimentares para registro nutricional revisável.",
        `Texto disponível: ${composedText || "não informado"}`,
        `Rótulo sugerido pelo horário: ${suggestedMealLabel}`,
        `Histórico relevante do usuário:\n${habitsToPrompt(input.habits)}`,
        ...(intentHintToPrompt(input.intentHint) ? [`Contexto do classificador de intenção:\n${intentHintToPrompt(input.intentHint)}`] : []),
        "Retorne apenas JSON válido no schema solicitado.",
        "Inclua somente alimentos ou bebidas explicitamente mencionados, fotografados ou claramente visíveis.",
        "Se a mensagem tiver apenas saudação, conversa genérica ou texto sem alimento, retorne items como lista vazia e confidence baixo.",
        "Se a imagem não mostrar alimento ou bebida consumível com segurança suficiente, retorne items como lista vazia, confidence baixo e explique a incerteza no reasoning.",
        "Use o histórico apenas para calibrar porções de alimentos já mencionados ou claramente visíveis; nunca inclua alimentos apenas porque aparecem nos hábitos do usuário.",
        "Em fotos de embalagem, pote, rótulo, etiqueta ou balança, identifique no máximo os alimentos consumíveis claramente visíveis ou rotulados; não transforme a cena em uma refeição completa.",
        "Separe quantidade, unidade e alimento quando o usuário escrever algo como '140g Carne moída suína': quantity deve ser 140, unit deve ser 'g', foodName deve ser apenas 'Carne moída suína' e portionText deve ser derivado como '140 g'.",
        "Para exemplos como '300g amendoim japonês', '330ml cerveja', '2 fatias pão' e '1 long neck', nunca coloque a quantidade ou unidade em foodName; preserve marcas no nome do produto quando forem parte da identidade.",
        "Normalize unidades comuns: grama/gramas/gr como g, mililitro/mililitros como ml, litro/litros como l, fatias como fatia e longneck como long neck.",
        "Não inclua prato, talheres, mesa, embalagem, rótulo, marca isolada, decoração ou itens inferidos apenas por hábito.",
        "Quando houver foto de rótulo ou tabela nutricional, use os valores da tabela para calorias, proteína, carboidratos e gorduras; não substitua por valores genéricos de catálogo.",
        "Quando usar tabela nutricional visível, cite isso no campo reasoning.",
        "Se o usuário informar quantidade junto da foto, registre exatamente essa quantidade em quantity, unit, portionText e estimatedGrams quando a unidade permitir conversão; ajuste os macronutrientes proporcionalmente à tabela nutricional.",
        "Quando houver texto legível em embalagem, rótulo, etiqueta de preço ou etiqueta de balança com nome de alimento, use esse texto como identidade principal do item em foodName.",
        "Exemplo obrigatório: se o rótulo legível indicar 'PÃO DE CENOURA', trate o item como 'pão de cenoura' e não substitua por água ou por outro alimento genérico.",
        "Use o rótulo apenas para identificar o alimento real e a porção consumida; não crie itens extras a partir de ingredientes da embalagem.",
        "Nunca transforme lista de ingredientes em itens separados da refeição; ingredientes no rótulo servem apenas como contexto do produto principal.",
        "Se houver peso líquido, peso drenado, peso na etiqueta da balança ou porção declarada visível (ex.: 200 g, 500 ml), use esse valor como porção estimada quando fizer sentido para o item identificado.",
        "Quando reconhecer alimento consumível com segurança, mas sem tabela nutricional visível nem macros confiáveis, não deixe calorias nem macronutrientes zerados; use uma estimativa média proporcional à porção informada e explique que é estimado.",
        "Em foto com embalagem, rótulo ou alimento visível, não use água como fallback apenas por transparência, brilho, reflexo ou plástico translúcido.",
        "Só classifique como água quando houver evidência explícita de água consumida (texto legível contendo 'água' ou recipiente claramente de água sem rótulo de outro alimento).",
        "Não invente totais agregados; detalhe por item com quantidade, unidade, porção, gramas estimados e macronutrientes por item.",
        "Não use nomes de alimentos para inferir o tipo de refeição: café como bebida não significa café da manhã.",
        "Use elementos de referência visual na imagem (como o tamanho do prato, talheres, copos ou as mãos do usuário) para calibrar e estimar com maior precisão o peso em gramas de cada alimento.",
        "Alimentos ricos em amido (arroz, batata, massa, pão) costumam ter maior volume e peso no prato; calibre sua estimativa de gramas levando em conta a densidade típica desses alimentos.",
        "Ao estimar porções, prefira valores em gramas (estimatedGrams) a descrições vagas como '1 porção'; use referências visuais de escala para chegar a um número realista.",
        "Se houver tabela nutricional visível no rótulo, extraia os valores textuais com precisão de OCR — leia cada número individualmente e use-os diretamente em estimatedCalories e estimatedMacros sem arredondamentos desnecessários.",
      ].join("\n"),
    },
  ];

  if (input.imageUrl) {
    content.push({
      type: "input_image",
      image_url: input.imageUrl,
      detail: "high",
    });
  }

  const aiInput: AiProviderTextRequest["input"] = [
    {
      role: "user",
      content,
    },
  ];

  const response = await getAiProvider().createTextResponse({
    model: ENV.visionModel,
    instructions: "Você é um nutricionista assistente especializado em análise visual de refeições. Identifique apenas alimentos e bebidas consumíveis presentes na entrada, estime porções realistas usando referências visuais de escala (talheres, pratos, copos) e devolva apenas JSON estruturado para um rascunho revisável. Nunca inclua texto fora do JSON. Quando a entrada não mencionar nem mostrar alimento ou bebida com segurança, devolva items como lista vazia em vez de chutar. Priorize quantity e unit separados, mantendo portionText apenas como rótulo derivado.",
    input: aiInput,
    format: {
      type: "json_schema",
      name: "meal_extraction",
      schema: mealExtractionJsonSchema,
      strict: true,
    },
  });

  const parsed = safeJsonParse<unknown>(response.outputText);
  if (!parsed) {
    return null;
  }

  const validation = mealExtractionSchema.safeParse(parsed);
  if (!validation.success) {
    return null;
  }

  return validation.data;
}
