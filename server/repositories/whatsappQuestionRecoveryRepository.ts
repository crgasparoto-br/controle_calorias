import { and, asc, eq, gte, isNull } from "drizzle-orm";
import {
  whatsappConversationMessages,
  whatsappConversations,
} from "../../drizzle/schema";
import { whatsappMessageProcessingClaims } from "../../drizzle/whatsapp-processing-schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type RecoverableWhatsappQuestion = {
  messageId: number;
  conversationId: number;
  userId: number;
  phoneNumber: string;
  externalMessageId: string;
  text: string;
  occurredAt: Date;
  processingHeartbeatAt: Date | null;
};

export type WhatsAppQuestionRecoveryLookupStatus =
  | "candidates"
  | "no_eligible_candidates"
  | "active_owner_blocked"
  | "lookup_failed";

export type WhatsAppQuestionRecoveryLookupDiagnostics = {
  status: WhatsAppQuestionRecoveryLookupStatus;
  scanned: number;
  eligible: number;
  activeOwnerBlocked: number;
  ineligible: number;
  truncated: boolean;
};

export type WhatsAppQuestionRecoveryLookupResult = {
  candidates: RecoverableWhatsappQuestion[];
  diagnostics: WhatsAppQuestionRecoveryLookupDiagnostics;
};

type QuestionRecoveryLookupInput = {
  now?: Date;
  horizonMs: number;
  limit: number;
  processingStaleBefore?: Date;
};

export type WhatsAppQuestionRecoveryRepository = {
  findRecoverableQuestions(input: QuestionRecoveryLookupInput): Promise<RecoverableWhatsappQuestion[]>;
  /**
   * Extensão opcional para preservar compatibilidade com doubles antigos. O
   * repository produtivo sempre implementa este caminho diagnosticável.
   */
  findRecoverableQuestionsWithDiagnostics?: (
    input: QuestionRecoveryLookupInput,
  ) => Promise<WhatsAppQuestionRecoveryLookupResult>;
};

const DEFAULT_RECOVERY_PROCESSING_HEARTBEAT_TIMEOUT_MS = 30 * 1000;
const MAX_DIAGNOSTIC_SCAN_ROWS = 1_000;

type RecoveryRow = {
  messageId: number;
  conversationId: number;
  userId: number;
  phoneNumber: string | null;
  externalMessageId: string | null;
  text: string | null;
  occurredAt: Date;
  createdAt: Date;
  processingHeartbeatAt: Date | null;
};

function isActiveOwner(heartbeatAt: Date | null, staleBefore: Date) {
  return Boolean(
    heartbeatAt
    && Number.isFinite(heartbeatAt.getTime())
    && heartbeatAt.getTime() >= staleBefore.getTime(),
  );
}

function toCandidate(row: RecoveryRow) {
  const externalMessageId = row.externalMessageId?.trim();
  const text = row.text?.trim();
  const phoneNumber = row.phoneNumber?.trim();
  if (!externalMessageId || !text?.startsWith("/") || !phoneNumber) return null;
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    userId: row.userId,
    phoneNumber,
    externalMessageId,
    text,
    occurredAt: row.occurredAt,
    processingHeartbeatAt: row.processingHeartbeatAt ?? null,
  } satisfies RecoverableWhatsappQuestion;
}

function buildDiagnostics(input: {
  scanned: number;
  eligible: number;
  activeOwnerBlocked: number;
  ineligible: number;
  truncated: boolean;
}) : WhatsAppQuestionRecoveryLookupDiagnostics {
  const status: WhatsAppQuestionRecoveryLookupStatus = input.eligible > 0
    ? "candidates"
    : input.activeOwnerBlocked > 0
      ? "active_owner_blocked"
      : "no_eligible_candidates";
  return { status, ...input };
}

export function createDrizzleWhatsAppQuestionRecoveryRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WhatsAppQuestionRecoveryRepository {
  const findRecoverableQuestionsWithDiagnostics = async ({
    now = new Date(),
    horizonMs,
    limit,
    processingStaleBefore = new Date(
      now.getTime() - DEFAULT_RECOVERY_PROCESSING_HEARTBEAT_TIMEOUT_MS,
    ),
  }: QuestionRecoveryLookupInput): Promise<WhatsAppQuestionRecoveryLookupResult> => {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit || 1), 50));
    const safeHorizonMs = Math.max(60_000, horizonMs);
    const notBefore = new Date(now.getTime() - safeHorizonMs);
    const diagnosticScanLimit = Math.min(
      MAX_DIAGNOSTIC_SCAN_ROWS,
      Math.max(safeLimit * 10, 50),
    );
    const db = await deps.getDb();
    if (!db) {
      const error = new Error("database unavailable for WhatsApp question recovery lookup");
      deps.onWarning("WhatsApp question recovery candidate lookup unavailable", error);
      return {
        candidates: [],
        diagnostics: {
          status: "lookup_failed",
          scanned: 0,
          eligible: 0,
          activeOwnerBlocked: 0,
          ineligible: 0,
          truncated: false,
        },
      };
    }

    try {
      const rows: RecoveryRow[] = await db
        .select({
          messageId: whatsappConversationMessages.id,
          conversationId: whatsappConversationMessages.conversationId,
          userId: whatsappConversationMessages.userId,
          phoneNumber: whatsappConversations.phoneNumber,
          externalMessageId: whatsappConversationMessages.externalMessageId,
          text: whatsappConversationMessages.sanitizedText,
          occurredAt: whatsappConversationMessages.occurredAt,
          createdAt: whatsappConversationMessages.createdAt,
          processingHeartbeatAt: whatsappMessageProcessingClaims.heartbeatAt,
        })
        .from(whatsappConversationMessages)
        .innerJoin(
          whatsappConversations,
          eq(
            whatsappConversations.id,
            whatsappConversationMessages.conversationId,
          ),
        )
        .leftJoin(
          whatsappMessageProcessingClaims,
          eq(
            whatsappMessageProcessingClaims.messageId,
            whatsappConversationMessages.id,
          ),
        )
        .where(and(
          eq(whatsappConversationMessages.direction, "inbound"),
          eq(whatsappConversationMessages.contentType, "text"),
          isNull(whatsappConversationMessages.processedAt),
          gte(whatsappConversationMessages.createdAt, notBefore),
        ))
        .orderBy(
          asc(whatsappConversationMessages.createdAt),
          asc(whatsappConversationMessages.id),
        )
        .limit(diagnosticScanLimit);

      const eligibleRows = rows.filter(row => Boolean(toCandidate(row)));
      const activeOwnerBlocked = eligibleRows.filter(row =>
        isActiveOwner(row.processingHeartbeatAt ?? null, processingStaleBefore),
      ).length;
      const candidateRows = eligibleRows.filter(row =>
        !isActiveOwner(row.processingHeartbeatAt ?? null, processingStaleBefore),
      );
      const candidates = candidateRows
        .map(row => toCandidate(row))
        .filter((candidate): candidate is RecoverableWhatsappQuestion => Boolean(candidate))
        .slice(0, safeLimit);
      const diagnostics = buildDiagnostics({
        scanned: rows.length,
        eligible: candidateRows.length,
        activeOwnerBlocked,
        ineligible: rows.length - eligibleRows.length,
        truncated: rows.length >= diagnosticScanLimit,
      });

      return { candidates, diagnostics };
    } catch (error) {
      deps.onWarning("WhatsApp question recovery candidate lookup failed", error);
      return {
        candidates: [],
        diagnostics: {
          status: "lookup_failed",
          scanned: 0,
          eligible: 0,
          activeOwnerBlocked: 0,
          ineligible: 0,
          truncated: false,
        },
      };
    }
  };

  return {
    findRecoverableQuestionsWithDiagnostics,
    async findRecoverableQuestions(input) {
      const result = await findRecoverableQuestionsWithDiagnostics(input);
      return result.candidates;
    },
  };
}
