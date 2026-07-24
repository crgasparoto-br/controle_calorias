import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { professionalHistoryEvents } from "../../../drizzle/professional-schema";
import { getDb, logPersistenceWarning } from "../../db";
import { professionalRepository } from "./persistenceService";

const ACCESS_REQUEST_RECEIVED_EVENT = "access_request_received";
const ACCESS_REQUEST_LINKED_EVENT = "access_request_linked";
const ACCESS_REQUEST_RECEIPT_ENTITY = "request_access_receipt";
const UNRESOLVED_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECEIPTS = 50;
const MAX_SCANNED_RECEIPTS = 200;

export type ProfessionalAccessRequestReceipt = {
  id: string;
  status: "pending";
  requestedAt: number;
  linkedAuthorizationId: string | null;
};

type StoredReceipt = ProfessionalAccessRequestReceipt & {
  professionalUserId: number;
};

type Row = Record<string, unknown>;

type ReceiptRepositoryDependencies = {
  getDb: () => Promise<any>;
  onWarning: (scope: string, error: unknown) => void;
  professionalRepository: typeof professionalRepository;
  useDatabaseInTests?: boolean;
};

function rowsFromResult(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}

function asTimestamp(value: unknown) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function legacyReceiptId(professionalUserId: number, authorizationId: string) {
  const digest = crypto
    .createHash("sha256")
    .update(`${professionalUserId}:${authorizationId}`)
    .digest("hex")
    .slice(0, 48);
  return `req-${digest}`;
}

function toPublicReceipt(
  receipt: StoredReceipt
): ProfessionalAccessRequestReceipt {
  return {
    id: receipt.id,
    status: "pending",
    requestedAt: receipt.requestedAt,
    linkedAuthorizationId: receipt.linkedAuthorizationId,
  };
}

export function createProfessionalAccessRequestReceiptRepository(
  dependencies: ReceiptRepositoryDependencies = {
    getDb,
    onWarning: logPersistenceWarning,
    professionalRepository,
  }
) {
  const fallbackReceipts = new Map<string, StoredReceipt>();

  async function getReceiptDb() {
    if (
      (process.env.NODE_ENV === "test" || process.env.VITEST === "true") &&
      !dependencies.useDatabaseInTests
    ) {
      return null;
    }
    const db = await dependencies.getDb();
    if (!db && process.env.NODE_ENV === "production") {
      throw new Error(
        "A persistência das solicitações profissionais está temporariamente indisponível."
      );
    }
    return db;
  }

  async function createUnresolvedReceipt(
    professionalUserId: number,
    requestedAt = Date.now()
  ): Promise<ProfessionalAccessRequestReceipt> {
    const receipt: StoredReceipt = {
      id: crypto.randomUUID(),
      professionalUserId,
      status: "pending",
      requestedAt,
      linkedAuthorizationId: null,
    };
    const db = await getReceiptDb();
    if (!db) {
      fallbackReceipts.set(receipt.id, receipt);
      return toPublicReceipt(receipt);
    }

    try {
      await db.insert(professionalHistoryEvents).values({
        id: receipt.id,
        actorUserId: professionalUserId,
        professionalUserId,
        patientUserId: null,
        eventType: ACCESS_REQUEST_RECEIVED_EVENT,
        entityType: ACCESS_REQUEST_RECEIPT_ENTITY,
        entityId: null,
        occurredAt: new Date(requestedAt),
      });
      return toPublicReceipt(receipt);
    } catch (error) {
      dependencies.onWarning(
        "professional.access_request_receipt.create",
        error
      );
      throw error;
    }
  }

  async function createLinkedReceipt(input: {
    professionalUserId: number;
    authorizationId: string;
    patientUserId: number;
    requestedAt?: number;
  }): Promise<ProfessionalAccessRequestReceipt> {
    const requestedAt = input.requestedAt ?? Date.now();
    const receipt: StoredReceipt = {
      id: crypto.randomUUID(),
      professionalUserId: input.professionalUserId,
      status: "pending",
      requestedAt,
      linkedAuthorizationId: input.authorizationId,
    };
    const db = await getReceiptDb();
    if (!db) {
      fallbackReceipts.set(receipt.id, receipt);
      return toPublicReceipt(receipt);
    }

    try {
      await db.transaction(async (tx: any) => {
        await tx.insert(professionalHistoryEvents).values({
          id: receipt.id,
          actorUserId: input.professionalUserId,
          professionalUserId: input.professionalUserId,
          patientUserId: null,
          eventType: ACCESS_REQUEST_RECEIVED_EVENT,
          entityType: ACCESS_REQUEST_RECEIPT_ENTITY,
          entityId: null,
          occurredAt: new Date(requestedAt),
        });
        await tx.insert(professionalHistoryEvents).values({
          id: crypto.randomUUID(),
          actorUserId: input.professionalUserId,
          professionalUserId: input.professionalUserId,
          patientUserId: input.patientUserId,
          eventType: ACCESS_REQUEST_LINKED_EVENT,
          entityType: receipt.id,
          entityId: input.authorizationId,
          occurredAt: new Date(requestedAt),
        });
      });
      return toPublicReceipt(receipt);
    } catch (error) {
      dependencies.onWarning("professional.access_request_receipt.link", error);
      throw error;
    }
  }

  async function resolveAuthorizationIdForPatient(
    receiptId: string,
    patientUserId: number
  ): Promise<string | null> {
    const db = await getReceiptDb();
    if (!db) {
      const receipt = fallbackReceipts.get(receiptId);
      if (!receipt?.linkedAuthorizationId) return null;
      const authorization =
        await dependencies.professionalRepository.getAuthorizationById(
          receipt.linkedAuthorizationId
        );
      return authorization?.patientUserId === patientUserId
        ? authorization.id
        : null;
    }

    try {
      const result = await db.execute(sql`
        SELECT authorization.id
        FROM professionalHistoryEvents linked
        INNER JOIN professionalPatientAuthorizations authorization
          ON authorization.id = linked.entityId
        WHERE linked.eventType = ${ACCESS_REQUEST_LINKED_EVENT}
          AND linked.entityType = ${receiptId}
          AND linked.patientUserId = ${patientUserId}
          AND authorization.patientUserId = ${patientUserId}
        LIMIT 1
      `);
      const id = rowsFromResult(result)[0]?.id;
      return typeof id === "string" && id ? id : null;
    } catch (error) {
      dependencies.onWarning(
        "professional.access_request_receipt.resolve",
        error
      );
      throw error;
    }
  }

  async function listFallbackReceipts(
    professionalUserId: number,
    now: number
  ): Promise<ProfessionalAccessRequestReceipt[]> {
    const authorizations =
      await dependencies.professionalRepository.listAuthorizationsByProfessional(
        professionalUserId
      );
    const authorizationById = new Map(
      authorizations.map(authorization => [authorization.id, authorization])
    );
    const receipts: ProfessionalAccessRequestReceipt[] = [];
    const authorizationsWithReceipt = new Set<string>();
    const storedReceipts = [...fallbackReceipts.values()]
      .filter(receipt => receipt.professionalUserId === professionalUserId)
      .sort(
        (left, right) =>
          right.requestedAt - left.requestedAt || right.id.localeCompare(left.id)
      );

    for (const receipt of storedReceipts) {
      if (!receipt.linkedAuthorizationId) {
        if (receipt.requestedAt >= now - UNRESOLVED_RECEIPT_TTL_MS) {
          receipts.push(toPublicReceipt(receipt));
        }
        continue;
      }
      if (
        authorizationById.get(receipt.linkedAuthorizationId)?.status !==
        "pending"
      ) {
        continue;
      }
      authorizationsWithReceipt.add(receipt.linkedAuthorizationId);
      receipts.push(toPublicReceipt(receipt));
    }

    for (const authorization of authorizations) {
      if (
        authorization.status !== "pending" ||
        authorizationsWithReceipt.has(authorization.id)
      ) {
        continue;
      }
      receipts.push({
        id: legacyReceiptId(professionalUserId, authorization.id),
        status: "pending",
        requestedAt: authorization.requestedAt.getTime(),
        linkedAuthorizationId: authorization.id,
      });
    }

    return receipts
      .sort(
        (left, right) =>
          right.requestedAt - left.requestedAt || right.id.localeCompare(left.id)
      )
      .slice(0, MAX_RECEIPTS);
  }

  async function listActiveReceipts(
    professionalUserId: number,
    now = Date.now()
  ): Promise<ProfessionalAccessRequestReceipt[]> {
    const db = await getReceiptDb();
    if (!db) return listFallbackReceipts(professionalUserId, now);

    try {
      const [receiptResult, pendingResult] = await Promise.all([
        db.execute(sql`
          SELECT
            received.id,
            received.occurredAt,
            linked.entityId AS linkedAuthorizationId,
            authorization.status AS authorizationStatus
          FROM professionalHistoryEvents received
          LEFT JOIN professionalHistoryEvents linked
            ON linked.professionalUserId = received.professionalUserId
            AND linked.eventType = ${ACCESS_REQUEST_LINKED_EVENT}
            AND linked.entityType = received.id
          LEFT JOIN professionalPatientAuthorizations authorization
            ON authorization.id = linked.entityId
            AND authorization.professionalUserId = received.professionalUserId
          WHERE received.professionalUserId = ${professionalUserId}
            AND received.eventType = ${ACCESS_REQUEST_RECEIVED_EVENT}
          ORDER BY received.occurredAt DESC, received.id DESC
          LIMIT ${MAX_SCANNED_RECEIPTS}
        `),
        db.execute(sql`
          SELECT id, requestedAt
          FROM professionalPatientAuthorizations
          WHERE professionalUserId = ${professionalUserId}
            AND status = 'pending'
          ORDER BY requestedAt DESC, id DESC
          LIMIT ${MAX_SCANNED_RECEIPTS}
        `),
      ]);

      const receipts: ProfessionalAccessRequestReceipt[] = [];
      const authorizationsWithReceipt = new Set<string>();

      for (const row of rowsFromResult(receiptResult)) {
        const id = typeof row.id === "string" ? row.id : "";
        const requestedAt = asTimestamp(row.occurredAt);
        const linkedAuthorizationId =
          typeof row.linkedAuthorizationId === "string"
            ? row.linkedAuthorizationId
            : null;
        const authorizationStatus =
          typeof row.authorizationStatus === "string"
            ? row.authorizationStatus
            : null;
        if (!id || !requestedAt) continue;
        if (linkedAuthorizationId) {
          if (authorizationStatus !== "pending") continue;
          authorizationsWithReceipt.add(linkedAuthorizationId);
        } else if (requestedAt < now - UNRESOLVED_RECEIPT_TTL_MS) {
          continue;
        }
        receipts.push({
          id,
          status: "pending",
          requestedAt,
          linkedAuthorizationId,
        });
      }

      for (const row of rowsFromResult(pendingResult)) {
        const authorizationId = typeof row.id === "string" ? row.id : "";
        if (!authorizationId || authorizationsWithReceipt.has(authorizationId)) {
          continue;
        }
        const requestedAt = asTimestamp(row.requestedAt);
        receipts.push({
          id: legacyReceiptId(professionalUserId, authorizationId),
          status: "pending",
          requestedAt,
          linkedAuthorizationId: authorizationId,
        });
      }

      return receipts
        .sort(
          (left, right) =>
            right.requestedAt - left.requestedAt || right.id.localeCompare(left.id)
        )
        .slice(0, MAX_RECEIPTS);
    } catch (error) {
      dependencies.onWarning("professional.access_request_receipt.list", error);
      throw error;
    }
  }

  return {
    createUnresolvedReceipt,
    createLinkedReceipt,
    resolveAuthorizationIdForPatient,
    listActiveReceipts,
    _forTestOnlyClear: () => fallbackReceipts.clear(),
  };
}

export const professionalAccessRequestReceiptRepository =
  createProfessionalAccessRequestReceiptRepository();

export function _forTestOnly_clearProfessionalAccessRequestReceipts() {
  professionalAccessRequestReceiptRepository._forTestOnlyClear();
}
