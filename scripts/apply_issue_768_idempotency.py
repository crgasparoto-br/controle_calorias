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

# Repository: atomic lease claim for stale, unprocessed messages.
path = 'server/repositories/whatsappConversationRepository.ts'
replace_once(path,
'''  findDomainLinksForMessage(messageId: number): Promise<WhatsAppMessageDomainLinkRecord[]>;
  markProcessed(messageId: number, processedAt?: Date): Promise<void>;
''',
'''  findDomainLinksForMessage(messageId: number): Promise<WhatsAppMessageDomainLinkRecord[]>;
  claimStaleUnprocessedMessage(messageId: number, staleBefore: Date, claimedAt?: Date): Promise<boolean>;
  markProcessed(messageId: number, processedAt?: Date): Promise<void>;
''')
replace_once(path,
'''    async markProcessed(messageId, processedAt = new Date()) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db
          .update(whatsappConversationMessages)
          .set({ processedAt })
          .where(eq(whatsappConversationMessages.id, messageId));
      } catch (error) {
        deps.onWarning("WhatsApp conversation message mark-processed skipped", error);
      }
    },
''',
'''    async claimStaleUnprocessedMessage(messageId, staleBefore, claimedAt = new Date()) {
      const db = await deps.getDb();
      if (!db) return false;

      try {
        const result = await db
          .update(whatsappConversationMessages)
          .set({ updatedAt: claimedAt })
          .where(and(
            eq(whatsappConversationMessages.id, messageId),
            isNull(whatsappConversationMessages.processedAt),
            lt(whatsappConversationMessages.updatedAt, staleBefore),
          ));
        return getMysqlAffectedRows(result) > 0;
      } catch (error) {
        deps.onWarning("WhatsApp conversation stale message claim skipped", error);
        return false;
      }
    },

    async markProcessed(messageId, processedAt = new Date()) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db
          .update(whatsappConversationMessages)
          .set({ processedAt, updatedAt: processedAt })
          .where(eq(whatsappConversationMessages.id, messageId));
      } catch (error) {
        deps.onWarning("WhatsApp conversation message mark-processed skipped", error);
      }
    },
''')

# Media pipeline enriches through the active runtime service.
path = 'server/modules/whatsapp/webhookMediaPipeline.ts'
replace_once(path,
'''  buildSavedMedia,
  getDb,
  getUserIdByWhatsappPhone,
  logInferenceEvent,
  logPersistenceWarning,
} from "../../db";
import { createDrizzleWhatsAppConversationMessageEnrichmentRepository } from "../../repositories/whatsappConversationMessageEnrichmentRepository";
''',
'''  buildSavedMedia,
  getUserIdByWhatsappPhone,
  logInferenceEvent,
} from "../../db";
import { enrichInboundMessage } from "./messageLifecycle";
''')
replace_once(path,
'''const conversationMessageEnrichmentRepository = createDrizzleWhatsAppConversationMessageEnrichmentRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
''', '')
replace_once(path,
'''  await conversationMessageEnrichmentRepository.enrichInboundMessageByExternalId(message.id, {
''',
'''  await enrichInboundMessage(message.id, {
''')

# Base webhook: persistent processing claim and a request scope shared with chained handlers.
path = 'server/whatsappWebhook.ts'
replace_once(path,
'''  beginInboundMessage,
  markMessageProcessed,
''',
'''  beginInboundMessage,
  claimMessageForProcessing,
  markMessageProcessed,
''')
replace_once(path,
'''  recordOutboundReply,
  type MessageLifecycleHandle,
''',
'''  recordOutboundReply,
  runWithMessageLifecycleRequestScope,
  type MessageLifecycleHandle,
''')
replace_once(path,
'''export async function handleWhatsAppWebhook(req: Request, res: Response) {
''',
'''async function handleWhatsAppWebhookInternal(req: Request, res: Response) {
''')
base_begin = '''    const lifecycleHandle = await beginInboundMessage({
      userId,
      whatsappConnectionId: null,
      phoneNumber: sourcePhone,
      externalMessageId: message.id,
      contentType: message.image?.id && message.audio?.id
        ? "multimodal"
        : message.image?.id
          ? "image"
          : message.audio?.id
            ? "audio"
            : "text",
      text: message.text?.body ?? null,
      captionText: message.image?.caption ?? null,
      occurredAt: resolveWhatsAppMessageOccurredAt(message),
      allowRawContentStorage: true,
    });

'''
replace_once(path, base_begin, base_begin + '''    if (!await claimMessageForProcessing(lifecycleHandle)) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.idempotency.duplicate_detected",
        detail: JSON.stringify({ source: "persistent_processing_claim", flow: "base" }),
      });
      continue;
    }

''')
write(path, read(path) + '''\nexport async function handleWhatsAppWebhook(req: Request, res: Response) {\n  return runWithMessageLifecycleRequestScope(() => handleWhatsAppWebhookInternal(req, res));\n}\n''')

# Annotated-image webhook: opaque key, persistent claim and enrichment of the same inbound row.
path = 'server/whatsappAnnotatedImageWebhook.ts'
replace_once(path, 'import { Request, Response } from "express";\n', 'import { randomUUID } from "node:crypto";\nimport { Request, Response } from "express";\n')
replace_once(path,
'''  beginInboundMessage,
  markMessageProcessed,
''',
'''  beginInboundMessage,
  claimMessageForProcessing,
  enrichInboundMessage,
  markMessageProcessed,
''')
replace_once(path,
'''  recordOutboundReply,
  type MessageLifecycleHandle,
''',
'''  recordOutboundReply,
  runWithMessageLifecycleRequestScope,
  type MessageLifecycleHandle,
''')
replace_once(path,
'''  const fileName = `${sourcePhone}-${imageId}.${extension}`;
''',
'''  const fileName = `image-${randomUUID()}.${extension}`;
''')
replace_once(path,
'''const annotatedImageMessageDeduplicationCache = createMessageDeduplicationCache();
''',
'''const annotatedImageMessageDeduplicationCache = createMessageDeduplicationCache();

export function __resetWhatsAppAnnotatedImageDeduplicationForTests() {
  annotatedImageMessageDeduplicationCache.clear();
}
''')
replace_once(path,
'''  let userId: number | null = null;
  let lifecycleHandle: MessageLifecycleHandle = null;
''',
'''  let userId: number | null = null;
  let lifecycleHandle: MessageLifecycleHandle = null;
  let lifecycleClaimed = false;
''')
annotated_begin = '''    lifecycleHandle = await beginInboundMessage({
      userId,
      whatsappConnectionId: null,
      phoneNumber: sourcePhone,
      externalMessageId: message.id,
      contentType: message.audio?.id ? "multimodal" : "image",
      captionText: getTextBody(message) || null,
      occurredAt: resolveWhatsAppMessageOccurredAt(message),
      allowRawContentStorage: true,
    });

'''
replace_once(path, annotated_begin, annotated_begin + '''    lifecycleClaimed = await claimMessageForProcessing(lifecycleHandle);
    if (!lifecycleClaimed) {
      markAnnotatedImageMessageHandled(message.id);
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.idempotency.duplicate_detected",
        detail: JSON.stringify({ source: "persistent_processing_claim", flow: "image" }),
      });
      return true;
    }

''')
replace_once(path,
'''    const prepared = await prepareImageMessage(message, sourcePhone);
    if (prepared.storageWarning) {
''',
'''    const prepared = await prepareImageMessage(message, sourcePhone);
    const primaryMedia = prepared.media[0];
    await enrichInboundMessage(message.id, {
      mediaStorageKey: primaryMedia?.storageKey,
      mediaMimeType: primaryMedia?.mimeType,
      allowRawContentStorage: true,
    });
    if (prepared.storageWarning) {
''')
replace_once(path,
'''  } finally {
    await markMessageProcessed(lifecycleHandle);
  }
}

export async function handleWhatsAppWebhookWithAnnotatedImages(req: Request, res: Response) {
''',
'''  } finally {
    if (lifecycleClaimed) {
      await markMessageProcessed(lifecycleHandle);
    }
  }
}

async function handleWhatsAppWebhookWithAnnotatedImagesInternal(req: Request, res: Response) {
''')
write(path, read(path) + '''\nexport async function handleWhatsAppWebhookWithAnnotatedImages(req: Request, res: Response) {\n  return runWithMessageLifecycleRequestScope(() => handleWhatsAppWebhookWithAnnotatedImagesInternal(req, res));\n}\n''')

# Text-intent webhook uses the same persistent claim; passthrough remains owner in the request scope.
path = 'server/whatsappIntentWebhook.ts'
replace_once(path,
'''  beginInboundMessage,
  markMessageProcessed,
''',
'''  beginInboundMessage,
  claimMessageForProcessing,
  markMessageProcessed,
''')
replace_once(path,
'''  recordOutboundReply,
  wasMessageAlreadyProcessed,
  type MessageLifecycleHandle,
''',
'''  recordOutboundReply,
  runWithMessageLifecycleRequestScope,
  type MessageLifecycleHandle,
''')
replace_once(path,
'''  // Idempotência de domínio (issue #767): se esta mensagem (mesmo externalMessageId) já
  // tinha um registro de domínio vinculado, é uma reentrega — não repete a ação nem gera
  // nova resposta funcional, só confirma o recebimento.
  if (await wasMessageAlreadyProcessed(lifecycleHandle)) {
    markTextIntentMessageHandled(message.id);
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.idempotency.duplicate_detected",
      detail: JSON.stringify({ source: "db_unique_constraint" }),
    });
    await markMessageProcessed(lifecycleHandle);
    return true;
  }
''',
'''  if (!await claimMessageForProcessing(lifecycleHandle)) {
    markTextIntentMessageHandled(message.id);
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.idempotency.duplicate_detected",
      detail: JSON.stringify({ source: "persistent_processing_claim", flow: "text" }),
    });
    return true;
  }
''')
replace_once(path,
'''export async function handleWhatsAppWebhookWithTextIntent(req: Request, res: Response) {
''',
'''async function handleWhatsAppWebhookWithTextIntentInternal(req: Request, res: Response) {
''')
write(path, read(path) + '''\nexport async function handleWhatsAppWebhookWithTextIntent(req: Request, res: Response) {\n  return runWithMessageLifecycleRequestScope(() => handleWhatsAppWebhookWithTextIntentInternal(req, res));\n}\n''')

# Lifecycle tests and common handler mocks.
path = 'server/modules/whatsapp/messageLifecycle.test.ts'
replace_once(path,
'''  findDomainLinksForMessage: vi.fn(),
  markProcessed: vi.fn(),
''',
'''  findDomainLinksForMessage: vi.fn(),
  claimStaleUnprocessedMessage: vi.fn(),
  markProcessed: vi.fn(),
''')
replace_once(path,
'''vi.mock("../../db", () => ({
''',
'''vi.mock("../../repositories/whatsappConversationMessageEnrichmentRepository", () => ({
  createDrizzleWhatsAppConversationMessageEnrichmentRepository: () => ({ enrichInboundMessageByExternalId: vi.fn() }),
}));

vi.mock("../../db", () => ({
''')
replace_once(path,
'''import { beginInboundMessage, markMessageProcessed, recordDomainLink, recordOutboundReply, wasMessageAlreadyProcessed } from "./messageLifecycle";
''',
'''import { beginInboundMessage, claimMessageForProcessing, markMessageProcessed, recordDomainLink, recordOutboundReply, wasMessageAlreadyProcessed } from "./messageLifecycle";
''')
anchor = '''  it("detecta mensagem já processada (reentrega com domínio já vinculado) — issue #767", async () => {
'''
content = read(path)
if anchor not in content:
    raise RuntimeError('Lifecycle test anchor missing')
content = content.replace(anchor, '''  it("usa lease persistente para permitir somente um retry de mensagem abandonada", async () => {
    repositoryMock.claimStaleUnprocessedMessage.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const handle = { conversationId: 10, messageId: 100, wasNewInsert: false };
    expect(await claimMessageForProcessing(handle, new Date("2026-07-11T12:20:00Z"))).toBe(true);
    expect(await claimMessageForProcessing(handle, new Date("2026-07-11T12:20:01Z"))).toBe(false);
  });

''' + anchor, 1)
write(path, content)

for test_path in ROOT.glob('server/**/*.test.ts'):
    content = test_path.read_text()
    if 'vi.mock("./modules/whatsapp/messageLifecycle"' not in content and 'vi.mock("../../modules/whatsapp/messageLifecycle"' not in content:
        continue
    if 'claimMessageForProcessing:' not in content:
        content = content.replace(
            '  beginInboundMessage: beginInboundMessageMock,\n',
            '  beginInboundMessage: beginInboundMessageMock,\n  claimMessageForProcessing: vi.fn(async () => true),\n  enrichInboundMessage: vi.fn(async () => true),\n  runWithMessageLifecycleRequestScope: async (operation: () => Promise<unknown>) => operation(),\n',
            1,
        )
    test_path.write_text(content)

print('persistent idempotency patch applied')
