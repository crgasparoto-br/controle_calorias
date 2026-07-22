import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { quickEditTokens } from "../../../drizzle/schema";
import {
  getDb,
  getHabitSnapshots,
  getUserWhatsappConnection,
  logInferenceEvent,
} from "../../db";
import { normalizeText } from "../../mealTextParsing";
import { processMealInput } from "../../nutritionEngine";
import { composeWhatsAppMealActionReply } from "../whatsapp/mealActionReplyComposer";
import { textReply } from "../whatsapp/replyContract";
import { sendWhatsAppLogicalReply } from "../whatsapp/replyTransport";
import type { MealItemInput } from "../meals/schemas";
import type { QuickEditMealUpdateInput } from "./schemas";
import { getQuickEditMeal, updateQuickEditMeal } from "./service";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

async function resolveValidatedTokenOwner(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ userId: quickEditTokens.userId })
    .from(quickEditTokens)
    .where(eq(quickEditTokens.tokenHash, hashToken(token)))
    .limit(1);
  return rows[0]?.userId ?? null;
}

function identity(value?: string | null) {
  return normalizeText(value ?? "");
}

function foodIdentityChanged(
  current: MealItemInput | undefined,
  next: MealItemInput
) {
  if (!current) return true;
  const currentIdentities = new Set(
    [identity(current.foodName), identity(current.canonicalName)].filter(
      Boolean
    )
  );
  const submittedIdentities = [
    identity(next.foodName),
    identity(next.canonicalName),
  ].filter(Boolean);
  return !submittedIdentities.some(value => currentIdentities.has(value));
}

function nutritionInputChanged(
  current: MealItemInput | undefined,
  next: MealItemInput
) {
  if (!current) return true;
  return (
    foodIdentityChanged(current, next) ||
    Number(current.quantity) !== Number(next.quantity) ||
    normalizeText(current.unit ?? "") !== normalizeText(next.unit ?? "") ||
    normalizeText(current.portionText ?? "") !==
      normalizeText(next.portionText ?? "") ||
    Number(current.estimatedGrams) !== Number(next.estimatedGrams)
  );
}

function explicitFoodText(item: MealItemInput) {
  return `${item.quantity} ${item.unit} de ${item.foodName}`;
}

async function recalculateChangedItems(input: {
  userId: number;
  currentItems: MealItemInput[];
  nextItems: MealItemInput[];
  occurredAt: Date;
  timeZone: string;
}) {
  const habits = await getHabitSnapshots(input.userId);
  const recalculated: MealItemInput[] = [];

  for (let index = 0; index < input.nextItems.length; index += 1) {
    const next = input.nextItems[index];
    const current = input.currentItems[index];
    if (next.foodId || !nutritionInputChanged(current, next)) {
      recalculated.push(next);
      continue;
    }

    const processed = await processMealInput({
      text: explicitFoodText(next),
      habits,
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
    });
    const resolved = processed.items[0];
    if (!resolved) {
      throw new Error("A edição não produziu referência nutricional válida.");
    }

    recalculated.push({
      ...next,
      ...resolved,
      foodName: next.foodName.trim(),
      canonicalName: resolved.canonicalName?.trim() || resolved.foodName.trim(),
      quantity: next.quantity,
      unit: next.unit,
      portionText: next.portionText,
    });
  }

  return recalculated;
}

async function sendQuickEditWhatsappConfirmation(input: {
  userId: number;
  meal: Awaited<ReturnType<typeof updateQuickEditMeal>>;
  timeZone: string;
}) {
  try {
    const connection = await getUserWhatsappConnection(input.userId);
    if (!connection?.phoneNumber || connection.status === "disabled") {
      logInferenceEvent({
        userId: input.userId,
        origin: "web",
        status: "warning",
        eventType: "quick_edit.whatsapp_confirmation_skipped",
        detail:
          "Edição salva sem confirmação WhatsApp porque não há conexão ativa.",
      });
      return;
    }

    const reply = await composeWhatsAppMealActionReply({
      userId: input.userId,
      meal: input.meal,
      timeZone: input.timeZone,
      options: {
        title: "Refeição atualizada",
        actionLines: ["Ajustes salvos pela edição rápida."],
        mealResultState: "updated",
      },
    });
    const delivery = await sendWhatsAppLogicalReply(
      connection.phoneNumber,
      textReply(reply)
    );
    logInferenceEvent({
      userId: input.userId,
      origin: "web",
      status: delivery.primaryOk ? "success" : "warning",
      eventType: delivery.primaryOk
        ? "quick_edit.whatsapp_confirmation_sent"
        : "quick_edit.whatsapp_confirmation_failed",
      detail: delivery.primaryOk
        ? "Confirmação pós-edição enviada com estado persistido recarregado."
        : "Edição salva, mas a confirmação pós-edição não foi entregue.",
    });
  } catch {
    logInferenceEvent({
      userId: input.userId,
      origin: "web",
      status: "warning",
      eventType: "quick_edit.whatsapp_confirmation_failed",
      detail:
        "Edição salva, mas ocorreu falha sanitizada ao montar ou enviar a confirmação WhatsApp.",
    });
  }
}

type QuickEditUpdateStage =
  | "load_current"
  | "revalidate_owner"
  | "recalculate"
  | "persist";

function classifyQuickEditUpdateError(error: unknown) {
  const code = String(
    (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code ??
      ""
  ).toUpperCase();
  if (code.startsWith("ER_") || code.includes("SQL")) return "database";
  if (
    error instanceof Error &&
    /nutricional|alimento|referência/i.test(error.message)
  ) {
    return "nutrition";
  }
  if (
    error instanceof Error &&
    /token|link|proprietário/i.test(error.message)
  ) {
    return "authorization";
  }
  return "unexpected";
}

function logQuickEditUpdateFailure(input: {
  error: unknown;
  stage: QuickEditUpdateStage;
  userId?: number;
  mealId?: number;
}) {
  logInferenceEvent({
    userId: input.userId,
    origin: "web",
    status: "error",
    eventType: "quick_edit.meal_update_failed",
    detail: `Falha sanitizada na edição rápida. stage=${input.stage}; category=${classifyQuickEditUpdateError(input.error)}; mealId=${input.mealId ?? "unknown"}.`,
  });
}

export async function updateQuickEditMealWithWhatsappConfirmation(
  token: string,
  input: QuickEditMealUpdateInput["meal"]
) {
  let stage: QuickEditUpdateStage = "load_current";
  let current: Awaited<ReturnType<typeof getQuickEditMeal>> | undefined;
  let userId: number | undefined;
  try {
    current = await getQuickEditMeal(token);
    stage = "revalidate_owner";
    userId = (await resolveValidatedTokenOwner(token)) ?? undefined;
    if (!userId) {
      throw new Error(
        "Não foi possível revalidar o proprietário do link de edição."
      );
    }

    stage = "recalculate";
    const items = await recalculateChangedItems({
      userId,
      currentItems: (current.meal.items ?? []) as MealItemInput[],
      nextItems: input.items as MealItemInput[],
      occurredAt: new Date(current.meal.occurredAt),
      timeZone: current.timeZone,
    });
    stage = "persist";
    const meal = await updateQuickEditMeal(token, { ...input, items });
    await sendQuickEditWhatsappConfirmation({
      userId,
      meal,
      timeZone: current.timeZone,
    });
    return meal;
  } catch (error) {
    logQuickEditUpdateFailure({
      error,
      stage,
      userId,
      mealId: current?.meal.id,
    });
    throw error;
  }
}
