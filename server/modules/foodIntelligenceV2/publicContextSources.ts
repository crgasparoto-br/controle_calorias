/** #1308 D1: inspect owner-scoped context without persisting raw text or media.
 * A source reference reports availability; it does not authorize using a
 * previous utterance or preference as proof of identity or nutrition.
 */
import { and, desc, eq, lt, lte } from "drizzle-orm";
import { meals, userPreferences, whatsappConversationMessages } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { FoodOperationEnvelope } from "./schemas";
import { WHATSAPP_CONVERSATION_ACTIVE_TTL_MS } from "../whatsapp/conversationPolicy";

export type FoodD1ContextSources = FoodOperationEnvelope["contextSources"];
export type FoodD1PublicContextRequest = {
  ownerUserId: number;
  source: "web" | "whatsapp";
  at: Date;
  externalMessageId?: string | null;
};
type ContextSource = FoodD1ContextSources["previousMessage"];
const state = (status: ContextSource["status"], reason: string | null,
  sourceRef: string | null = null): ContextSource => ({ status, reason, sourceRef });

/** A DB error is not proof of absence. The gated V2 path fails closed rather
 * than silently claiming that a user's existing preferences were not found.
 */
export async function readFoodD1PublicContextSources(
  request: FoodD1PublicContextRequest,
): Promise<FoodD1ContextSources> {
  if (!Number.isSafeInteger(request.ownerUserId) || request.ownerUserId <= 0 ||
      !(request.at instanceof Date) || !Number.isFinite(request.at.getTime()) ||
      (request.source !== "web" && request.source !== "whatsapp")) {
    throw new Error("food-d1-context-invalid-owner-or-time");
  }
  if (request.source === "whatsapp" &&
      (!request.externalMessageId?.trim() || request.externalMessageId.trim().length > 128)) {
    throw new Error("food-d1-context-external-message-required");
  }
  const db = await getDb();
  if (!db) throw new Error("food-d1-context-store-unavailable");
  const owner = request.ownerUserId;
  try {
    // This query is scoped to authenticated ownership and returns a reference,
    // never the value of a private preference.
    const [preference] = await db.select({ id: userPreferences.id, updatedAt: userPreferences.updatedAt })
      .from(userPreferences).where(eq(userPreferences.userId, owner))
      .orderBy(desc(userPreferences.id)).limit(1);
    const preferences = preference
      ? state("available", null, "food-preference:" + preference.id + ":" + preference.updatedAt.getTime())
      : state("absent", "no_user_preferences");

    // A historical meal is relevant only if it existed before this operation;
    // later meals (including an idempotent retry's write) cannot become its context.
    const [historical] = await db.select({ id: meals.id, createdAt: meals.createdAt })
      .from(meals).where(and(eq(meals.userId, owner), eq(meals.status, "confirmed"),
        lt(meals.createdAt, request.at)))
      .orderBy(desc(meals.createdAt), desc(meals.id)).limit(1);
    const age = historical ? request.at.getTime() - historical.createdAt.getTime() : null;
    const recentHistory = !historical ? state("absent", "no_prior_meal")
      : age !== null && age > 30 * 24 * 60 * 60 * 1000
        ? state("expired", "prior_meal_outside_context_window")
        : state("available", null, "food-history-meal:" + historical.id);

    if (request.source === "web") {
      return { previousMessage: state("not_applicable", "web_draft_has_no_conversation"),
        preferences, recentHistory };
    }
    // Resolve the CURRENT transport message first. Never select a previous
    // message by userId alone (that could cross conversations/phone sessions).
    const [current] = await db.select({
      id: whatsappConversationMessages.id,
      conversationId: whatsappConversationMessages.conversationId,
      occurredAt: whatsappConversationMessages.occurredAt,
    }).from(whatsappConversationMessages).where(and(
      eq(whatsappConversationMessages.userId, owner),
      eq(whatsappConversationMessages.direction, "inbound"),
      eq(whatsappConversationMessages.externalMessageId, request.externalMessageId!.trim()),
    )).limit(2);
    if (!current) {
      return { previousMessage: state("unavailable", "inbound_conversation_not_materialized"),
        preferences, recentHistory };
    }
    const [previous] = await db.select({
      id: whatsappConversationMessages.id,
      occurredAt: whatsappConversationMessages.occurredAt,
    }).from(whatsappConversationMessages).where(and(
      eq(whatsappConversationMessages.userId, owner),
      eq(whatsappConversationMessages.conversationId, current.conversationId),
      eq(whatsappConversationMessages.direction, "inbound"),
      lt(whatsappConversationMessages.id, current.id),
      lte(whatsappConversationMessages.occurredAt, current.occurredAt),
    )).orderBy(desc(whatsappConversationMessages.id)).limit(1);
    const previousMessage = !previous ? state("absent", "no_prior_message_in_conversation")
      : current.occurredAt.getTime() - previous.occurredAt.getTime() >
        WHATSAPP_CONVERSATION_ACTIVE_TTL_MS
        ? state("expired", "prior_conversation_message_expired")
        : state("available", null, "whatsapp-message:" + previous.id);
    return { previousMessage, preferences, recentHistory };
  } catch (error) {
    throw new Error("food-d1-context-read-failed", { cause: error });
  }
}
