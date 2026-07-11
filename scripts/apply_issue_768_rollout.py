from pathlib import Path

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text()

def write(path, content):
    (ROOT / path).write_text(content)

def replace_once(path, old, new):
    content = read(path)
    if old not in content:
        raise RuntimeError(f'Pattern not found in {path}: {old[:120]!r}')
    write(path, content.replace(old, new, 1))

# Build old and persistent contexts side by side and select them through rollout controls.
path = 'server/modules/whatsapp/intentContext.ts'
replace_once(path,
'''import { getOrRefreshConversationSummary } from "./conversationSummaryService";
''',
'''import { getOrRefreshConversationSummary } from "./conversationSummaryService";
import { getRecentConversationTurns } from "./conversationHistory";
import {
  getActiveWhatsappContextFlow,
  selectWhatsappConversationContext,
  type WhatsappContextFlow,
} from "./conversationContextRollout";
''')
replace_once(path,
'''const conversationRepository: WhatsAppConversationRepository = createDrizzleWhatsAppConversationRepository({
''',
'''const defaultConversationRepository: WhatsAppConversationRepository = createDrizzleWhatsAppConversationRepository({
''')
replace_once(path,
'''    consumer?: ConversationContextConsumer;
  } = {},
''',
'''    consumer?: ConversationContextConsumer;
    flow?: WhatsappContextFlow;
    conversationRepository?: WhatsAppConversationRepository;
  } = {},
''')
replace_once(path,
'''  const consumer = options.consumer ?? "intent_classifier";
  const budget = CONTEXT_BUDGETS[consumer];
''',
'''  const consumer = options.consumer ?? "intent_classifier";
  const budget = CONTEXT_BUDGETS[consumer];
  const flow = options.flow ?? getActiveWhatsappContextFlow("text");
  const repository = options.conversationRepository ?? defaultConversationRepository;
''')
replace_once(path,
'''  const persistedMessages = await conversationRepository.findRecentMessagesByUser(userId, RECENT_MESSAGES_FETCH_LIMIT);
  const { window, overflow, truncated } = selectRecentWindow(persistedMessages, budget);
''',
'''  const persistedMessages = await repository.findRecentMessagesByUser(userId, RECENT_MESSAGES_FETCH_LIMIT);
  const { window, overflow, truncated } = selectRecentWindow(persistedMessages, budget);
  const persistentTurns = window.map(message => ({
    direction: message.direction,
    text: getEffectiveMessageText(message) || null,
    occurredAtIso: new Date(message.occurredAt).toISOString(),
  }));
  const legacyTurns = getRecentConversationTurns(userId, receivedAt.getTime()).flatMap(turn => [
    {
      direction: "inbound" as const,
      text: turn.userMessage || null,
      occurredAtIso: new Date(turn.occurredAtMs).toISOString(),
    },
    ...(turn.botReply ? [{
      direction: "outbound" as const,
      text: turn.botReply,
      occurredAtIso: new Date(turn.occurredAtMs).toISOString(),
    }] : []),
  ]);
  const rolloutSelection = selectWhatsappConversationContext({
    userId,
    flow,
    legacyTurns,
    persistentTurns,
  });
''')
replace_once(path,
'''      contextSource: conversationSummary ? "summary" : window.length > 0 ? "recent_window" : "db_fallback",
      contextVersion: "whatsapp-intent-context/v2",
      conversationActive,
''',
'''      contextSource: rolloutSelection.source,
      contextMode: rolloutSelection.mode,
      contextFlow: rolloutSelection.flow,
      persistentEligible: rolloutSelection.persistentEligible,
      equivalent: rolloutSelection.equivalent,
      legacyCount: rolloutSelection.legacyCount,
      persistentCount: rolloutSelection.persistentCount,
      contextVersion: "whatsapp-intent-context/v2",
      conversationActive,
''')
replace_once(path,
'''    recentTurns: window.map(message => ({
      direction: message.direction,
      text: getEffectiveMessageText(message) || null,
      occurredAtIso: new Date(message.occurredAt).toISOString(),
    })),
    conversationSummary,
''',
'''    recentTurns: rolloutSelection.turns,
    conversationSummary: rolloutSelection.source === "persistent" ? conversationSummary : null,
''')

# Associate the real entrypoints with rollout flow scopes.
path = 'server/whatsappIntentWebhook.ts'
replace_once(path,
'''import { toLogicalDateInTimeZone } from "../shared/timeZone";
''',
'''import { toLogicalDateInTimeZone } from "../shared/timeZone";
import { withWhatsappContextFlow } from "./modules/whatsapp/conversationContextRollout";
''')
replace_once(path,
'''export async function handleWhatsAppWebhookWithTextIntent(req: Request, res: Response) {
  return runWithMessageLifecycleRequestScope(() => handleWhatsAppWebhookWithTextIntentInternal(req, res));
}
''',
'''export async function handleWhatsAppWebhookWithTextIntent(req: Request, res: Response) {
  return runWithMessageLifecycleRequestScope(() => withWhatsappContextFlow("text", () => handleWhatsAppWebhookWithTextIntentInternal(req, res)));
}
''')

path = 'server/whatsappAnnotatedImageWebhook.ts'
replace_once(path,
'''import { MealInferenceError, processMealInput, type MealProcessingResult } from "./nutritionEngine";
''',
'''import { MealInferenceError, processMealInput, type MealProcessingResult } from "./nutritionEngine";
import { withWhatsappContextFlow } from "./modules/whatsapp/conversationContextRollout";
''')
replace_once(path,
'''export async function handleWhatsAppWebhookWithAnnotatedImages(req: Request, res: Response) {
  return runWithMessageLifecycleRequestScope(() => handleWhatsAppWebhookWithAnnotatedImagesInternal(req, res));
}
''',
'''export async function handleWhatsAppWebhookWithAnnotatedImages(req: Request, res: Response) {
  return runWithMessageLifecycleRequestScope(() => withWhatsappContextFlow("image", () => handleWhatsAppWebhookWithAnnotatedImagesInternal(req, res)));
}
''')

path = 'server/whatsappWebhook.ts'
replace_once(path,
'''import { splitMealItemsForWaterHydration } from "./modules/whatsapp/waterItemClassification";
''',
'''import { splitMealItemsForWaterHydration } from "./modules/whatsapp/waterItemClassification";
import { withWhatsappContextFlow } from "./modules/whatsapp/conversationContextRollout";
''')
replace_once(path,
'''        const interpreted = await executeWhatsappTextIntent(userId, {
          text: prepared.transcript,
          receivedAt: resolveWhatsAppMessageOccurredAt(message),
        });
''',
'''        const interpreted = await withWhatsappContextFlow("audio", () => executeWhatsappTextIntent(userId, {
          text: prepared.transcript,
          receivedAt: resolveWhatsAppMessageOccurredAt(message),
        }));
''')

print('context rollout patch applied')
