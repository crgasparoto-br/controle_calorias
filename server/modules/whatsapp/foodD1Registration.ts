/** #1308 trusted WhatsApp transport adapter; no nutritional identity/score is chosen here. */
import { listUserMeals } from "../../db";
import { parseMealCommandFromWhatsApp } from "./mealCommandParser";
import { buildWhatsAppPartialRegistrationWarning,
  buildWhatsAppRegisteredPersistedMealReplyMessage } from "./replyMessages";
import { hasActiveWhatsappPendingInDb } from "../foodIntelligenceV2/publicSimulator";
import { createFoodD1PublicWhatsAppRegistration,
  type PublicD1WhatsAppDependencies } from "../foodIntelligenceV2/publicWhatsAppRegistration";

type Meal = Awaited<ReturnType<typeof listUserMeals>>[number];
type WhatsAppD1RegistrationDependencies = Partial<Omit<PublicD1WhatsAppDependencies,
  "readCanonicalOperation" | "renderCommittedMeal">> & {
  parseOperation?: typeof parseMealCommandFromWhatsApp;
  readMeal?: (userId: number, mealId: number) => Promise<Meal | null>;
};

export function createWhatsAppD1RegistrationService(
  deps: WhatsAppD1RegistrationDependencies = {},
) {
  return createFoodD1PublicWhatsAppRegistration({
    readAuthorizedContext: deps.readAuthorizedContext ?? (async () => null),
    readActivePending: deps.readActivePending ?? hasActiveWhatsappPendingInDb,
    lexicon: deps.lexicon, knowledge: deps.knowledge, run: deps.run,
    readCanonicalOperation: async (rawText, context) => {
      const operation = (deps.parseOperation ?? parseMealCommandFromWhatsApp)(
        rawText, context,
      );
      if (operation.intent !== "add_items_to_meal" || !operation.mealType?.trim() ||
          !(operation.date instanceof Date) || !Number.isFinite(operation.date.getTime()) ||
          !operation.items.length || operation.missingFields.length ||
          operation.items.some(item => !item.foodName?.trim() ||
            item.quantity === null || !Number.isFinite(item.quantity) ||
            item.quantity <= 0 || !item.unit?.trim())) {
        throw new Error("food-d1-whatsapp-public-meal-operation-unresolved");
      }
      return { mealType: operation.mealType, date: operation.date,
        itemCount: operation.items.length };
    },
    renderCommittedMeal: async ({ userId, mealId, registeredAt, timeZone, skipped }) => {
      const meal = await (deps.readMeal ??
        (async (ownerUserId, id) => (await listUserMeals(ownerUserId)).find(entry =>
          entry.id === id && entry.userId === ownerUserId) ?? null))(userId, mealId);
      if (!meal || meal.userId !== userId || meal.id !== mealId || !meal.items?.length) {
        throw new Error("food-d1-whatsapp-public-committed-meal-unavailable");
      }
      const rendered = buildWhatsAppRegisteredPersistedMealReplyMessage(meal, {
        registeredAt, timeZone,
      });
      const warning = skipped.length
        ? buildWhatsAppPartialRegistrationWarning(skipped.map((_item, index) => ({
            segment: "Item " + (index + 1),
            reason: "Identidade, medida ou fonte nutricional ainda não confirmada.",
          })))
        : null;
      return warning ? rendered + "\n\n" + warning : rendered;
    },
  });
}
export const tryRunPublicFoodD1WhatsAppRegistration =
  createWhatsAppD1RegistrationService();
