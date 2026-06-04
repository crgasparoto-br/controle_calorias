import { AsyncLocalStorage } from "node:async_hooks";

export type WhatsAppGoalProgressContext = {
  exerciseCaloriesByDateKey: Record<string, number>;
};

const whatsappGoalProgressContext = new AsyncLocalStorage<WhatsAppGoalProgressContext>();

export function runWithWhatsAppGoalProgressContext<T>(context: WhatsAppGoalProgressContext, callback: () => T): T {
  return whatsappGoalProgressContext.run(context, callback);
}

export function getWhatsAppExerciseCaloriesForDateKey(dateKey?: string) {
  if (!dateKey) {
    return undefined;
  }

  const context = whatsappGoalProgressContext.getStore();
  return context?.exerciseCaloriesByDateKey[dateKey];
}
