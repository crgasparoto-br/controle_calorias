import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppConversationRepository,
  type WhatsAppConversationRepository,
} from "../../repositories/whatsappConversationRepository";
import { resolveQuestionContextScope } from "./questionContextPlan";
import { executeWhatsappAiQuestionIntent as executeWhatsappAiQuestionIntentCore } from "./aiQuestionAssistantCore";

export * from "./aiQuestionAssistantCore";

type QuestionInput = Parameters<typeof executeWhatsappAiQuestionIntentCore>[1];

function extractQuestion(text?: string | null) {
  const trimmed = text?.trim() ?? "";
  if (!trimmed.startsWith("/")) return null;
  return trimmed.replace(/^\/+/, "").trim() || null;
}

function withoutRecentHistory(
  repository: WhatsAppConversationRepository,
): WhatsAppConversationRepository {
  return {
    ...repository,
    async findRecentMessagesByUser() {
      return [];
    },
  };
}

export async function executeWhatsappAiQuestionIntent(
  userId: number,
  input: QuestionInput,
) {
  const question = extractQuestion(input.text);
  if (!question || resolveQuestionContextScope(question) !== "none") {
    return executeWhatsappAiQuestionIntentCore(userId, input);
  }

  const repository = input.conversationRepository
    ?? createDrizzleWhatsAppConversationRepository({
      getDb,
      onWarning: logPersistenceWarning,
    });

  return executeWhatsappAiQuestionIntentCore(userId, {
    ...input,
    conversationRepository: withoutRecentHistory(repository),
  });
}
