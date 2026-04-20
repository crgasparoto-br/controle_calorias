import { createPendingMealInference, getPendingInferenceFromDb } from '../server/db.ts';

const processed = {
  sourceText: 'Validação pós-migração: 1 banana prata',
  transcript: undefined,
  reasoning: 'Registro sintético para validar a persistência de inferências após a migração 0002.',
  confidence: 0.99,
  detectedMealLabel: 'Lanche',
  items: [
    {
      foodName: 'Banana prata',
      canonicalName: 'Banana',
      portionText: '1 unidade',
      servings: 1,
      estimatedGrams: 80,
      calories: 72,
      protein: 0.9,
      carbs: 18.6,
      fat: 0.2,
      confidence: 0.99,
      source: 'catalog',
    },
  ],
  totals: {
    calories: 72,
    protein: 0.9,
    carbs: 18.6,
    fat: 0.2,
  },
};

const draft = createPendingMealInference(1, 'web', processed, []);
await new Promise((resolve) => setTimeout(resolve, 500));
const persisted = await getPendingInferenceFromDb(draft.draftId);

console.log(JSON.stringify({
  draftId: draft.draftId,
  persisted: Boolean(persisted),
  persistedDraftId: persisted?.draftId ?? null,
  sourceText: persisted?.processed.sourceText ?? null,
  totals: persisted?.processed.totals ?? null,
}, null, 2));
