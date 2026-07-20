import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import {
  getDb,
  getUserWhatsappConnection,
  logPersistenceWarning,
} from "../../db";
import { sendWhatsAppStandaloneLogicalReply } from "../whatsapp/logicalReplyDelivery";
import { textReply } from "../whatsapp/replyContract";
import type {
  PatientProfessionalMessageListInput,
  ProfessionalMessageCreateInput,
  ProfessionalMessageListInput,
} from "./schemas";

type Row = Record<string, unknown>;
function rows(result: unknown): Row[] {
  return Array.isArray(result)
    ? ((Array.isArray(result[0]) ? result[0] : result) as Row[])
    : [];
}
function affected(result: unknown) {
  const value = Array.isArray(result) ? result[0] : result;
  return Number((value as { affectedRows?: number })?.affectedRows ?? 0);
}
function time(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}
function safeError(code: string) {
  return code === "NO_CHANNEL"
    ? "Paciente sem canal de WhatsApp ativo."
    : "Não foi possível entregar pelo WhatsApp.";
}

async function dbRequired() {
  const db = await getDb();
  if (!db)
    throw new Error(
      "As mensagens profissionais estão temporariamente indisponíveis."
    );
  return db;
}

async function professionalScope(
  professionalUserId: number,
  patientUserId: number
) {
  const db = await dbRequired();
  const result =
    await db.execute(sql`SELECT a.id AS authorizationId, a.status AS authorizationStatus,
    COALESCE(t.status, 'not_started') AS trackingStatus, p.active AS profileActive
    FROM professionalPatientAuthorizations a
    INNER JOIN professionalProfiles p ON p.userId = a.professionalUserId
    LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
    WHERE a.professionalUserId = ${professionalUserId} AND a.patientUserId = ${patientUserId}
      AND a.status = 'approved' AND p.active = 1 ORDER BY a.approvedAt DESC LIMIT 1`);
  const row = rows(result)[0];
  if (!row)
    throw new Error("O acesso a este paciente não está mais disponível.");
  return {
    db,
    authorizationId: String(row.authorizationId),
    trackingStatus: String(row.trackingStatus),
  };
}

function assertCanCreate(
  trackingStatus: string,
  type: ProfessionalMessageCreateInput["messageType"],
  action: ProfessionalMessageCreateInput["action"]
) {
  if (action === "save_draft") return;
  if (trackingStatus === "active") return;
  if (trackingStatus === "paused" && type === "administrative") return;
  if (trackingStatus === "ended")
    throw new Error(
      "O acompanhamento foi encerrado e não aceita novas mensagens."
    );
  throw new Error(
    "Durante a pausa, envie somente comunicações administrativas."
  );
}

function responseCode() {
  return `RESP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}
function isRequest(type: string) {
  return (
    type === "weigh_in_request" ||
    type === "record_request" ||
    type === "reminder"
  );
}
function serialize(row: Row) {
  return {
    id: String(row.id),
    conversationId: String(row.conversationId),
    professionalUserId: Number(row.professionalUserId),
    patientUserId: Number(row.patientUserId),
    direction: String(row.direction),
    origin: String(row.origin),
    messageType: String(row.messageType),
    content: String(row.content ?? ""),
    state: String(row.state),
    responseCode: row.responseCode ? String(row.responseCode) : null,
    inReplyToMessageId: row.inReplyToMessageId
      ? String(row.inReplyToMessageId)
      : null,
    lastError: row.lastError ? String(row.lastError) : null,
    sentAt: time(row.sentAt),
    receivedAt: time(row.receivedAt),
    createdAt: time(row.createdAt),
    authorName: row.authorName ? String(row.authorName) : null,
  };
}

async function history(
  db: Awaited<ReturnType<typeof dbRequired>>,
  input: {
    actorUserId: number;
    professionalUserId: number;
    patientUserId: number;
    eventType: string;
    messageId: string;
  }
) {
  await db.execute(sql`INSERT INTO professionalHistoryEvents (id, actorUserId, professionalUserId, patientUserId, eventType, entityType, entityId, occurredAt)
    VALUES (${crypto.randomUUID()}, ${input.actorUserId}, ${input.professionalUserId}, ${input.patientUserId}, ${input.eventType}, 'professional_message', ${input.messageId}, NOW())`);
}

export async function createProfessionalMessage(
  professionalUserId: number,
  input: ProfessionalMessageCreateInput
) {
  const scope = await professionalScope(professionalUserId, input.patientId);
  assertCanCreate(scope.trackingStatus, input.messageType, input.action);
  if (input.origin === "automatic" && input.action !== "save_draft")
    throw new Error(
      "Mensagens automáticas precisam ser revisadas antes do envio."
    );
  const messageId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const state = input.action === "save_draft" ? "draft" : "pending";
  const code = isRequest(input.messageType) ? responseCode() : null;
  try {
    await scope.db.transaction(async tx => {
      await tx.execute(sql`INSERT INTO professionalConversations (id, authorizationId, professionalUserId, patientUserId, lastMessageAt)
        VALUES (${conversationId}, ${scope.authorizationId}, ${professionalUserId}, ${input.patientId}, NOW())
        ON DUPLICATE KEY UPDATE lastMessageAt = NOW()`);
      const conversationResult = await tx.execute(
        sql`SELECT id FROM professionalConversations WHERE authorizationId = ${scope.authorizationId} LIMIT 1`
      );
      const canonicalConversationId = String(
        rows(conversationResult)[0]?.id ?? conversationId
      );
      await tx.execute(sql`INSERT INTO professionalMessages (id, conversationId, authorizationId, professionalUserId, patientUserId,
        authorUserId, direction, origin, messageType, content, state, idempotencyKey, responseCode, relatedGuidanceId, supersedesMessageId)
        VALUES (${messageId}, ${canonicalConversationId}, ${scope.authorizationId}, ${professionalUserId}, ${input.patientId},
        ${professionalUserId}, 'professional_to_patient', ${input.origin}, ${input.messageType}, ${input.content}, ${state},
        ${input.idempotencyKey}, ${code}, ${input.relatedGuidanceId ?? null}, ${input.supersedesMessageId ?? null})`);
    });
  } catch (error) {
    const existing = await scope.db.execute(
      sql`SELECT * FROM professionalMessages WHERE idempotencyKey = ${input.idempotencyKey} LIMIT 1`
    );
    if (rows(existing)[0]) return serialize(rows(existing)[0]);
    throw error;
  }
  await history(scope.db, {
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: input.patientId,
    eventType:
      state === "draft"
        ? "professional_message_drafted"
        : "professional_message_created",
    messageId,
  });
  if (input.action === "send_web") {
    await scope.db.execute(
      sql`UPDATE professionalMessages SET state = 'sent', sentAt = NOW() WHERE id = ${messageId}`
    );
  } else if (input.action === "send_whatsapp")
    await deliverProfessionalMessage(messageId, professionalUserId);
  const result = await scope.db.execute(
    sql`SELECT * FROM professionalMessages WHERE id = ${messageId}`
  );
  return serialize(rows(result)[0]);
}

async function claimDelivery(messageId: string, professionalUserId: number) {
  const db = await dbRequired();
  const token = crypto.randomUUID();
  const update = await db.execute(sql`UPDATE professionalMessages m
    INNER JOIN professionalPatientAuthorizations a ON a.id = m.authorizationId
    LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
    SET m.state = 'pending', m.lastError = NULL, m.deliveryClaimToken = ${token}, m.deliveryClaimedAt = NOW()
    WHERE m.id = ${messageId} AND m.professionalUserId = ${professionalUserId} AND a.status = 'approved'
      AND m.direction = 'professional_to_patient' AND m.origin <> 'automatic' AND m.state IN ('draft','pending','failed')
      AND (m.deliveryClaimToken IS NULL OR m.deliveryClaimedAt < DATE_SUB(NOW(), INTERVAL 5 MINUTE))
      AND (t.status = 'active' OR (t.status = 'paused' AND m.messageType = 'administrative'))`);
  if (!affected(update)) return null;
  const messageResult =
    await db.execute(sql`SELECT m.*, p.displayName AS authorName FROM professionalMessages m
    LEFT JOIN professionalProfiles p ON p.userId = m.professionalUserId WHERE m.id = ${messageId} AND m.deliveryClaimToken = ${token} LIMIT 1`);
  const attemptResult = await db.execute(
    sql`SELECT COALESCE(MAX(attemptNumber),0)+1 AS number FROM professionalMessageDeliveryAttempts WHERE messageId = ${messageId}`
  );
  const attemptNumber = Number(rows(attemptResult)[0]?.number ?? 1);
  const attemptId = crypto.randomUUID();
  await db.execute(sql`INSERT INTO professionalMessageDeliveryAttempts (id, messageId, channel, attemptNumber, state, claimToken, claimedAt)
    VALUES (${attemptId}, ${messageId}, 'whatsapp', ${attemptNumber}, 'sending', ${token}, NOW())`);
  return { db, token, attemptId, row: rows(messageResult)[0] };
}

export async function deliverProfessionalMessage(
  messageId: string,
  professionalUserId: number
) {
  const claim = await claimDelivery(messageId, professionalUserId);
  if (!claim?.row) return { status: "unchanged" as const };
  let status: "sent" | "failed" = "failed";
  let errorCode: string | null = null;
  try {
    const connection = await getUserWhatsappConnection(
      Number(claim.row.patientUserId)
    );
    if (!connection || connection.status !== "active") errorCode = "NO_CHANNEL";
    else {
      const prefix =
        claim.row.origin === "ai_suggested"
          ? "Mensagem sugerida pela IA e revisada por"
          : claim.row.origin === "automatic"
            ? "Mensagem automática de"
            : "Mensagem de";
      const replyLine = claim.row.responseCode
        ? `\n\nPara responder a este pedido, inclua o código ${String(claim.row.responseCode)} na mensagem.`
        : "";
      const delivery = await sendWhatsAppStandaloneLogicalReply(
        connection.phoneNumber,
        textReply(
          `${prefix} ${String(claim.row.authorName ?? "seu nutricionista")}:\n\n${String(claim.row.content)}${replyLine}`
        )
      );
      status = delivery.result.primaryOk ? "sent" : "failed";
      if (status === "failed") errorCode = "CHANNEL_FAILURE";
    }
  } catch (error) {
    errorCode = "CHANNEL_FAILURE";
    logPersistenceWarning("professional_message_delivery", error);
  }
  const detail = errorCode ? safeError(errorCode) : null;
  await claim.db.transaction(async tx => {
    await tx.execute(
      sql`UPDATE professionalMessageDeliveryAttempts SET state = ${status}, errorCode = ${errorCode}, errorDetail = ${detail}, completedAt = NOW(), claimToken = NULL WHERE id = ${claim.attemptId} AND claimToken = ${claim.token}`
    );
    await tx.execute(
      sql`UPDATE professionalMessages SET state = ${status}, sentAt = ${status === "sent" ? new Date() : null}, lastError = ${detail}, deliveryClaimToken = NULL, deliveryClaimedAt = NULL WHERE id = ${messageId} AND deliveryClaimToken = ${claim.token}`
    );
  });
  await history(claim.db, {
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: Number(claim.row.patientUserId),
    eventType:
      status === "sent"
        ? "professional_message_sent"
        : "professional_message_failed",
    messageId,
  });
  return { status };
}

function cursorSql(cursor?: { createdAt: number; id: string }) {
  return cursor
    ? sql`AND (m.createdAt < ${new Date(cursor.createdAt)} OR (m.createdAt = ${new Date(cursor.createdAt)} AND m.id < ${cursor.id}))`
    : sql``;
}
export async function listProfessionalMessages(
  professionalUserId: number,
  input: ProfessionalMessageListInput
) {
  const db = await dbRequired();
  const patientFilter = input.patientId
    ? sql`AND m.patientUserId = ${input.patientId}`
    : sql``;
  const result =
    await db.execute(sql`SELECT m.*, COALESCE(u.name, p.displayName) AS authorName FROM professionalMessages m
    INNER JOIN professionalPatientAuthorizations a ON a.id = m.authorizationId
    LEFT JOIN users u ON u.id = m.authorUserId LEFT JOIN professionalProfiles p ON p.userId = m.professionalUserId
    WHERE m.professionalUserId = ${professionalUserId} AND a.status = 'approved' ${patientFilter} ${cursorSql(input.cursor)}
    ORDER BY m.createdAt DESC, m.id DESC LIMIT ${input.pageSize + 1}`);
  const items = rows(result);
  return {
    items: items.slice(0, input.pageSize).map(serialize),
    nextCursor:
      items.length > input.pageSize
        ? {
            createdAt: time(items[input.pageSize - 1].createdAt)!,
            id: String(items[input.pageSize - 1].id),
          }
        : null,
  };
}

export async function listPatientProfessionalMessages(
  patientUserId: number,
  input: PatientProfessionalMessageListInput
) {
  const db = await dbRequired();
  const result =
    await db.execute(sql`SELECT m.*, COALESCE(u.name, p.displayName) AS authorName FROM professionalMessages m
    INNER JOIN professionalPatientAuthorizations a ON a.id = m.authorizationId
    LEFT JOIN users u ON u.id = m.authorUserId LEFT JOIN professionalProfiles p ON p.userId = m.professionalUserId
    WHERE m.patientUserId = ${patientUserId} AND a.status = 'approved' AND m.state IN ('pending','sent','failed','received') ${cursorSql(input.cursor)}
    ORDER BY m.createdAt DESC, m.id DESC LIMIT ${input.pageSize + 1}`);
  const items = rows(result);
  return {
    items: items.slice(0, input.pageSize).map(serialize),
    nextCursor:
      items.length > input.pageSize
        ? {
            createdAt: time(items[input.pageSize - 1].createdAt)!,
            id: String(items[input.pageSize - 1].id),
          }
        : null,
  };
}

export async function tryAssociateProfessionalWhatsappResponse(input: {
  patientUserId: number;
  text: string;
  externalMessageId: string;
  receivedAt: Date;
}) {
  const matches = [
    ...input.text.toUpperCase().matchAll(/\bRESP-[A-F0-9]{8}\b/g),
  ].map(item => item[0]);
  if (matches.length !== 1) return null;
  const db = await dbRequired();
  const result =
    await db.execute(sql`SELECT m.* FROM professionalMessages m INNER JOIN professionalPatientAuthorizations a ON a.id = m.authorizationId
    WHERE m.patientUserId = ${input.patientUserId} AND m.responseCode = ${matches[0]} AND a.status = 'approved'
      AND m.state = 'sent' AND m.createdAt >= DATE_SUB(${input.receivedAt}, INTERVAL 30 DAY) LIMIT 1`);
  const parent = rows(result)[0];
  if (!parent)
    return {
      handled: true,
      reply:
        "Esse código não está mais disponível. Abra a Área do Paciente para consultar suas mensagens.",
      eventType: "whatsapp.professional_response.expired",
      detail: "Código de resposta profissional inválido ou expirado.",
    };
  const content = input.text.replace(new RegExp(matches[0], "ig"), "").trim();
  if (!content)
    return {
      handled: true,
      reply: `Escreva sua resposta junto com o código ${matches[0]}.`,
      eventType: "whatsapp.professional_response.empty",
      detail: "Resposta profissional sem conteúdo.",
    };
  const id = crypto.randomUUID();
  try {
    await db.execute(sql`INSERT INTO professionalMessages (id, conversationId, authorizationId, professionalUserId, patientUserId, authorUserId, direction, origin, messageType, content, state, idempotencyKey, inReplyToMessageId, receivedAt)
    VALUES (${id}, ${String(parent.conversationId)}, ${String(parent.authorizationId)}, ${Number(parent.professionalUserId)}, ${input.patientUserId}, ${input.patientUserId}, 'patient_to_professional', 'patient', 'response', ${content}, 'received', ${`whatsapp:professional-response:${input.externalMessageId}`}, ${String(parent.id)}, ${input.receivedAt})`);
  } catch {
    return {
      handled: true,
      reply: "Sua resposta já foi recebida.",
      eventType: "whatsapp.professional_response.duplicate",
      detail: "Callback profissional duplicado ignorado.",
    };
  }
  await db.execute(
    sql`UPDATE professionalConversations SET lastMessageAt = ${input.receivedAt} WHERE id = ${String(parent.conversationId)}`
  );
  await history(db, {
    actorUserId: input.patientUserId,
    professionalUserId: Number(parent.professionalUserId),
    patientUserId: input.patientUserId,
    eventType: "professional_message_response_received",
    messageId: id,
  });
  return {
    handled: true,
    reply:
      "Resposta enviada ao seu nutricionista e registrada no acompanhamento.",
    eventType: "whatsapp.professional_response.received",
    detail: "Resposta profissional associada por código explícito.",
  };
}
