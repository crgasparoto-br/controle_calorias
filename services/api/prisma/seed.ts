import { PrismaClient, NutritionSource } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Seed common Brazilian food items
  const foods = [
    {
      externalSource: 'TACO',
      name: 'Arroz branco cozido',
      nameNormalized: 'arroz branco cozido',
      category: 'Cereais e produtos de panificação',
      calories: 128,
      protein: 2.5,
      carbs: 28.1,
      fat: 0.2,
      fiber: 1.6,
      sodium: 1.0,
      sugar: 0,
      servingSizeG: 100,
      servingUnit: 'porção',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Feijão carioca cozido',
      nameNormalized: 'feijao carioca cozido',
      category: 'Leguminosas',
      calories: 76,
      protein: 4.8,
      carbs: 13.6,
      fat: 0.5,
      fiber: 8.5,
      sodium: 2.0,
      sugar: 0,
      servingSizeG: 86,
      servingUnit: 'concha',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Frango peito grelhado',
      nameNormalized: 'frango peito grelhado',
      category: 'Carnes e derivados',
      calories: 159,
      protein: 32.0,
      carbs: 0,
      fat: 3.2,
      fiber: 0,
      sodium: 68.0,
      sugar: 0,
      servingSizeG: 100,
      servingUnit: 'filé',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Ovo cozido',
      nameNormalized: 'ovo cozido',
      category: 'Ovos e derivados',
      calories: 146,
      protein: 13.3,
      carbs: 0.6,
      fat: 9.8,
      fiber: 0,
      sodium: 140.0,
      sugar: 0.6,
      servingSizeG: 50,
      servingUnit: 'unidade',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Banana prata',
      nameNormalized: 'banana prata',
      category: 'Frutas',
      calories: 98,
      protein: 1.3,
      carbs: 26.0,
      fat: 0.1,
      fiber: 2.0,
      sodium: 1.0,
      sugar: 17.0,
      servingSizeG: 87,
      servingUnit: 'unidade',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Pão francês',
      nameNormalized: 'pao frances',
      category: 'Cereais e produtos de panificação',
      calories: 300,
      protein: 8.0,
      carbs: 58.6,
      fat: 3.1,
      fiber: 2.3,
      sodium: 590.0,
      sugar: 2.0,
      servingSizeG: 50,
      servingUnit: 'unidade',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Leite integral',
      nameNormalized: 'leite integral',
      category: 'Leite e derivados',
      calories: 61,
      protein: 3.2,
      carbs: 4.7,
      fat: 3.3,
      fiber: 0,
      sodium: 49.0,
      sugar: 4.7,
      servingSizeG: 200,
      servingUnit: 'copo',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Alface',
      nameNormalized: 'alface',
      category: 'Verduras e legumes',
      calories: 11,
      protein: 1.3,
      carbs: 1.7,
      fat: 0.2,
      fiber: 1.8,
      sodium: 6.0,
      sugar: 0,
      servingSizeG: 40,
      servingUnit: 'folhas',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Batata doce cozida',
      nameNormalized: 'batata doce cozida',
      category: 'Verduras e legumes',
      calories: 77,
      protein: 0.6,
      carbs: 18.4,
      fat: 0.1,
      fiber: 2.2,
      sodium: 55.0,
      sugar: 5.7,
      servingSizeG: 100,
      servingUnit: 'porção',
      isVerified: true,
    },
    {
      externalSource: 'TACO',
      name: 'Aveia em flocos',
      nameNormalized: 'aveia em flocos',
      category: 'Cereais e produtos de panificação',
      calories: 394,
      protein: 13.9,
      carbs: 66.6,
      fat: 8.5,
      fiber: 9.1,
      sodium: 3.0,
      sugar: 0,
      servingSizeG: 40,
      servingUnit: 'colher',
      isVerified: true,
    },
  ];

  for (const food of foods) {
    await prisma.foodItem.upsert({
      where: {
        externalId_externalSource: {
          externalId: food.nameNormalized,
          externalSource: food.externalSource,
        },
      },
      create: { ...food, externalId: food.nameNormalized },
      update: food,
    });
  }

  // Seed prompt versions
  await prisma.promptVersion.upsert({
    where: { name_version: { name: 'food-extraction', version: 'v1.0' } },
    create: {
      name: 'food-extraction',
      version: 'v1.0',
      model: 'gpt-4o',
      isActive: true,
      content: `Você é um assistente nutricional especializado em culinária brasileira.

Analise a mensagem do usuário e extraia os alimentos mencionados com suas quantidades estimadas.

Retorne APENAS um JSON válido com o seguinte formato:
{
  "foods": [
    {
      "name": "nome do alimento",
      "quantity": número,
      "unit": "g|ml|unidade|colher|xícara|fatia|porção",
      "estimatedCalories": número,
      "protein": número,
      "carbs": número,
      "fat": número,
      "confidenceScore": 0.0-1.0
    }
  ],
  "mealType": "BREAKFAST|MORNING_SNACK|LUNCH|AFTERNOON_SNACK|DINNER|EVENING_SNACK|OTHER",
  "needsConfirmation": boolean,
  "confirmationMessage": "mensagem para o usuário se precisar confirmar"
}

Regras:
- Use quantidades típicas brasileiras quando não especificado
- Considere o horário da mensagem para inferir o tipo de refeição
- Se a confiança for < 0.7, solicite confirmação
- Seja preciso com os valores nutricionais`,
    },
    update: { isActive: true },
  });

  await prisma.promptVersion.upsert({
    where: { name_version: { name: 'response-generation', version: 'v1.0' } },
    create: {
      name: 'response-generation',
      version: 'v1.0',
      model: 'gpt-4o',
      isActive: true,
      content: `Você é um assistente nutricional amigável e motivador.

Com base nos dados fornecidos, gere uma resposta clara e objetiva em português do Brasil.

Dados:
- Refeição registrada: {{mealSummary}}
- Consumido hoje: {{consumed}}
- Meta diária: {{goal}}
- Saldo restante: {{remaining}}

Responda de forma:
- Concisa (máx 5 linhas)
- Com emojis relevantes 🥗
- Motivadora quando perto da meta
- Alerta quando ultrapassar a meta
- Dê uma dica nutricional relevante`,
    },
    update: { isActive: true },
  });

  console.log('✅ Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
