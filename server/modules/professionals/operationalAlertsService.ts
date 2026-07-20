import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { getDb, logPersistenceWarning } from "../../db";
import {
  buildOperationalAlertDedupeKey,
  getNoFoodRecordsWindow,
  shouldCloseWeighInRequest,
} from "./operationalAlertRules";

export const OPERATIONAL_ALERT_TYPES = [
  "no_food_records",
  "weigh_in_overdue",
  "goal_review_due",
  "professional_request_overdue",
  "record_requires_review",
] as const;

export type OperationalAlertType = (typeof OPERATIONAL_ALERT_TYPES)[number];
export type OperationalAlertState =
  | "open"
  | "resolved"
  | "dismissed"
  | "inactive";

type Row = Record<string, unknown>;
type AlertInput = {
  dedupeKey: string;
  type: OperationalAlertType;
  professionalUserId: number;
  patientUserId: number;
  authorizationId: string;
  originType: string;
  originId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  reason: string;
  severity?: "info" | "attention" | "urgent";
  suggestedAction: string;
};

const rows = (result: unknown): Row[] =>
  Array.isArray(result)
    ? ((Array.isArray(result[0]) ? result[0] : result) as Row[])
    : [];

const stamp = (value: unknown) =>
  value ? new Date(String(value)).getTime() : null;

function groupBy(items: Row[], key: string) {
  const map = new Map<string, Row[]>();
  for (const item of items) {
    const value = String(item[key]);
    map.set(value, [...(map.get(value) ?? []), item]);
  }
  return map;
}

function mapAlert(row: Row) {
  return {
    id: String(row.id),
    type: String(row.type) as OperationalAlertType,
    patientUserId: Number(row.patientUserId),
    patientName:
      String(row.patientDisplayName || row.patientName || "").trim() ||
      `Paciente #${Number(row.patientUserId)}`,
    authorizationId: String(row.authorizationId),
    origin: {
      type: String(row.originType),
      id: row.originId ? String(row.originId) : null,
    },
    period: {
      start: stamp(row.periodStart),
      end: stamp(row.periodEnd),
    },
    reason: String(row.reason),
    severity: String(row.severity) as "info" | "attention" | "urgent",
    state: String(row.state) as OperationalAlertState,
    suggestedAction: String(row.suggestedAction),
    createdAt: stamp(row.createdAt),
    updatedAt: stamp(row.updatedAt),
    resolvedAt: stamp(row.resolvedAt),
    resolvedByUserId: row.resolvedByUserId
      ? Number(row.resolvedByUserId)
      : null,
    resolutionNote: row.resolutionNote
      ? String(row.resolutionNote)
      : null,
  };
}

async function upsertAlert(db: any, input: AlertInput) {
  await db.execute(sql`
    INSERT INTO professionalOperationalAlerts (
      id, dedupeKey, type, professionalUserId, patientUserId,
      authorizationId, originType, originId, periodStart, periodEnd,
      reason, severity, state, suggestedAction
    ) VALUES (
      ${crypto.randomUUID()}, ${input.dedupeKey}, ${input.type},
      ${input.professionalUserId}, ${input.patientUserId},
      ${input.authorizationId}, ${input.originType}, ${input.originId ?? null},
      ${input.periodStart ?? null}, ${input.periodEnd ?? null},
      ${input.reason}, ${input.severity ?? "attention"}, 'open',
      ${input.suggestedAction}
    )
    ON DUPLICATE KEY UPDATE
      periodStart = VALUES(periodStart),
      periodEnd = VALUES(periodEnd),
      reason = VALUES(reason),
      severity = VALUES(severity),
      suggestedAction = VALUES(suggestedAction),
      state = IF(state IN ('resolved', 'dismissed'), state, 'open'),
      updatedAt = NOW()
  `);
}

async function closeCompletedWeighInRequests(
  db: any,
  requests: Row[],
  latestWeightByPatient: Map<number, Date | null>
) {
  const completedIds: string[] = [];

  for (const request of requests) {
    if (String(request.type) !== "weigh_in") continue;

    const latestWeight = latestWeightByPatient.get(Number(request.patientUserId));
    const createdAt = new Date(String(request.createdAt));
    if (!shouldCloseWeighInRequest(createdAt, latestWeight ?? null)) continue;

    completedIds.push(String(request.id));
  }

  for (const requestId of completedIds) {
    await db.execute(sql`
      UPDATE professionalOperationalRequests
      SET state = 'answered',
          answeredAt = COALESCE(answeredAt, NOW()),
          closedAt = COALESCE(closedAt, NOW()),
          closureReason = 'weight_recorded',
          updatedAt = NOW()
      WHERE id = ${requestId} AND state = 'open'
    `);
  }

  return new Set(completedIds);
}

async function safelyEvaluateRule(
  name: string,
  evaluator: () => Promise<void>
) {
  try {
    await evaluator();
  } catch (error) {
    logPersistenceWarning(`professional_operational_alert_${name}`, error);
  }
}

export async function evaluateProfessionalOperationalAlerts(
  professionalUserId: number,
  now = new Date()
) {
  const db = await getDb();
  if (!db) {
    throw new Error("A central de pendências está temporariamente indisponível.");
  }

  const [scopeResult, mealResult, requestResult, signalResult, weightResult] =
    await Promise.all([
      db.execute(sql`
        SELECT
          a.id AS authorizationId,
          a.patientUserId,
          COALESCE(p.timezone, ${DEFAULT_APP_TIME_ZONE}) AS timezone,
          t.nextReviewAt
        FROM professionalPatientAuthorizations a
        INNER JOIN professionalPatientTrackings t ON t.authorizationId = a.id
        LEFT JOIN userProfiles p ON p.userId = a.patientUserId
        WHERE a.professionalUserId = ${professionalUserId}
          AND a.status = 'approved'
          AND t.status = 'active'
      `),
      db.execute(sql`
        SELECT a.id AS authorizationId, MAX(m.occurredAt) AS lastMealAt
        FROM professionalPatientAuthorizations a
        INNER JOIN professionalPatientTrackings t ON t.authorizationId = a.id
        LEFT JOIN meals m
          ON m.userId = a.patientUserId
         AND m.status = 'confirmed'
        WHERE a.professionalUserId = ${professionalUserId}
          AND a.status = 'approved'
          AND t.status = 'active'
        GROUP BY a.id
      `),
      db.execute(sql`
        SELECT
          r.id, r.authorizationId, r.patientUserId, r.type,
          r.title, r.dueAt, r.createdAt
        FROM professionalOperationalRequests r
        INNER JOIN professionalPatientAuthorizations a
          ON a.id = r.authorizationId
        INNER JOIN professionalPatientTrackings t
          ON t.authorizationId = a.id
        WHERE a.professionalUserId = ${professionalUserId}
          AND a.status = 'approved'
          AND t.status = 'active'
          AND r.state = 'open'
      `),
      db.execute(sql`
        SELECT
          s.id, s.authorizationId, s.originType,
          s.originId, s.reason, s.createdAt
        FROM professionalReviewSignals s
        INNER JOIN professionalPatientAuthorizations a
          ON a.id = s.authorizationId
        INNER JOIN professionalPatientTrackings t
          ON t.authorizationId = a.id
        WHERE a.professionalUserId = ${professionalUserId}
          AND a.status = 'approved'
          AND t.status = 'active'
          AND s.state = 'open'
      `),
      db.execute(sql`
        SELECT a.patientUserId, MAX(w.measuredAt) AS latestWeightAt
        FROM professionalPatientAuthorizations a
        INNER JOIN professionalPatientTrackings t ON t.authorizationId = a.id
        LEFT JOIN weightEntries w ON w.userId = a.patientUserId
        WHERE a.professionalUserId = ${professionalUserId}
          AND a.status = 'approved'
          AND t.status = 'active'
        GROUP BY a.patientUserId
      `),
    ]);

  const scopes = rows(scopeResult);
  const lastMealByAuthorization = new Map<string, Date | null>(
    rows(mealResult).map(row => [
      String(row.authorizationId),
      row.lastMealAt ? new Date(String(row.lastMealAt)) : null,
    ])
  );
  const latestWeightByPatient = new Map<number, Date | null>(
    rows(weightResult).map(row => [
      Number(row.patientUserId),
      row.latestWeightAt ? new Date(String(row.latestWeightAt)) : null,
    ])
  );
  const requestRows = rows(requestResult);
  const automaticallyClosedRequestIds = await closeCompletedWeighInRequests(
    db,
    requestRows,
    latestWeightByPatient
  );
  const activeRequests = requestRows.filter(
    row => !automaticallyClosedRequestIds.has(String(row.id))
  );
  const requests = groupBy(activeRequests, "authorizationId");
  const signals = groupBy(rows(signalResult), "authorizationId");
  const activeKeys = new Set<string>();

  for (const scope of scopes) {
    const authorizationId = String(scope.authorizationId);
    const patientUserId = Number(scope.patientUserId);
    const timeZone = String(scope.timezone || DEFAULT_APP_TIME_ZONE);

    await safelyEvaluateRule("no_food_records", async () => {
      const period = getNoFoodRecordsWindow(now, timeZone);
      const lastMeal = lastMealByAuthorization.get(authorizationId);
      const key = buildOperationalAlertDedupeKey(
        authorizationId,
        "no_food_records",
        `${period.startDateKey}:${period.endDateKey}`
      );

      if (!lastMeal || lastMeal < period.start || lastMeal > period.end) {
        activeKeys.add(key);
        await upsertAlert(db, {
          dedupeKey: key,
          type: "no_food_records",
          professionalUserId,
          patientUserId,
          authorizationId,
          originType: "meals",
          periodStart: period.start,
          periodEnd: period.end,
          reason: `Nenhum registro alimentar confirmado entre ${period.startDateKey} e ${period.endDateKey} no timezone ${timeZone}.`,
          suggestedAction:
            "Revisar o acompanhamento e, se necessário, entrar em contato com o paciente.",
        });
      }
    });

    await safelyEvaluateRule("goal_review_due", async () => {
      if (!scope.nextReviewAt || new Date(String(scope.nextReviewAt)) > now) {
        return;
      }

      const reviewAt = new Date(String(scope.nextReviewAt));
      const originId = reviewAt.toISOString();
      const key = buildOperationalAlertDedupeKey(
        authorizationId,
        "goal_review_due",
        originId
      );
      activeKeys.add(key);
      await upsertAlert(db, {
        dedupeKey: key,
        type: "goal_review_due",
        professionalUserId,
        patientUserId,
        authorizationId,
        originType: "tracking_next_review",
        originId,
        periodEnd: reviewAt,
        reason: "A data de revisão definida para o acompanhamento foi alcançada.",
        suggestedAction: "Registrar a revisão ou reagendar a próxima data.",
      });
    });

    await safelyEvaluateRule("professional_requests", async () => {
      for (const request of requests.get(authorizationId) ?? []) {
        const dueAt = new Date(String(request.dueAt));
        if (dueAt > now) continue;

        const type: OperationalAlertType =
          String(request.type) === "weigh_in"
            ? "weigh_in_overdue"
            : "professional_request_overdue";
        const key = buildOperationalAlertDedupeKey(
          authorizationId,
          type,
          String(request.id)
        );
        activeKeys.add(key);
        await upsertAlert(db, {
          dedupeKey: key,
          type,
          professionalUserId,
          patientUserId,
          authorizationId,
          originType: "professional_request",
          originId: String(request.id),
          periodStart: new Date(String(request.createdAt)),
          periodEnd: dueAt,
          reason: `Prazo vencido: ${String(request.title)}.`,
          suggestedAction:
            type === "weigh_in_overdue"
              ? "Solicitar a pesagem ou encerrar a solicitação."
              : "Revisar a solicitação e registrar resposta, cancelamento ou dispensa.",
        });
      }
    });

    await safelyEvaluateRule("review_signals", async () => {
      for (const signal of signals.get(authorizationId) ?? []) {
        const key = buildOperationalAlertDedupeKey(
          authorizationId,
          "record_requires_review",
          String(signal.id)
        );
        activeKeys.add(key);
        await upsertAlert(db, {
          dedupeKey: key,
          type: "record_requires_review",
          professionalUserId,
          patientUserId,
          authorizationId,
          originType: String(signal.originType),
          originId: String(signal.originId),
          periodStart: new Date(String(signal.createdAt)),
          reason: String(signal.reason),
          suggestedAction:
            "Revisar o registro explicitamente marcado e corrigir ou invalidar o sinal.",
        });
      }
    });
  }

  const open = rows(
    await db.execute(sql`
      SELECT dedupeKey
      FROM professionalOperationalAlerts
      WHERE professionalUserId = ${professionalUserId} AND state = 'open'
    `)
  );
  const staleKeys = open
    .map(row => String(row.dedupeKey))
    .filter(key => !activeKeys.has(key));

  for (const key of staleKeys) {
    await db.execute(sql`
      UPDATE professionalOperationalAlerts
      SET state = 'inactive', updatedAt = NOW()
      WHERE professionalUserId = ${professionalUserId}
        AND dedupeKey = ${key}
        AND state = 'open'
    `);
  }

  return {
    evaluatedPatients: scopes.length,
    activeAlerts: activeKeys.size,
    automaticallyClosedRequests: automaticallyClosedRequestIds.size,
  };
}

export async function listProfessionalOperationalAlerts(
  professionalUserId: number,
  patientUserId?: number
) {
  await evaluateProfessionalOperationalAlerts(professionalUserId);
  const db = await getDb();
  if (!db) return [];

  const baseQuery = sql`
    SELECT
      alerts.*,
      users.name AS patientName,
      profiles.displayName AS patientDisplayName
    FROM professionalOperationalAlerts alerts
    INNER JOIN users ON users.id = alerts.patientUserId
    LEFT JOIN userProfiles profiles ON profiles.userId = alerts.patientUserId
    WHERE alerts.professionalUserId = ${professionalUserId}
      AND alerts.state = 'open'
  `;

  const result = patientUserId
    ? await db.execute(sql`${baseQuery} AND alerts.patientUserId = ${patientUserId} ORDER BY alerts.updatedAt DESC`)
    : await db.execute(sql`${baseQuery} ORDER BY alerts.severity DESC, alerts.updatedAt DESC LIMIT 500`);

  return rows(result).map(mapAlert);
}

export async function closeProfessionalOperationalAlert(
  professionalUserId: number,
  actorUserId: number,
  alertId: string,
  decision: "resolved" | "dismissed",
  note?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Não foi possível atualizar a pendência.");

  const alert = rows(
    await db.execute(sql`
      SELECT id, type, originType, originId
      FROM professionalOperationalAlerts
      WHERE id = ${alertId}
        AND professionalUserId = ${professionalUserId}
        AND state = 'open'
      LIMIT 1
    `)
  )[0];
  if (!alert) throw new Error("A pendência não está mais disponível.");

  await db.transaction(async tx => {
    await tx.execute(sql`
      UPDATE professionalOperationalAlerts
      SET state = ${decision},
          resolvedByUserId = ${actorUserId},
          resolvedAt = NOW(),
          resolutionNote = ${note ?? null},
          updatedAt = NOW()
      WHERE id = ${alertId}
        AND professionalUserId = ${professionalUserId}
        AND state = 'open'
    `);

    if (String(alert.originType) === "professional_request" && alert.originId) {
      await tx.execute(sql`
        UPDATE professionalOperationalRequests
        SET state = ${decision === "resolved" ? "answered" : "dismissed"},
            answeredAt = ${decision === "resolved" ? new Date() : null},
            closedAt = NOW(),
            closedByUserId = ${actorUserId},
            closureReason = ${
              decision === "resolved" ? "manual_resolution" : "dismissed"
            },
            updatedAt = NOW()
        WHERE id = ${String(alert.originId)}
          AND professionalUserId = ${professionalUserId}
          AND state = 'open'
      `);
    }

    if (String(alert.type) === "record_requires_review") {
      await tx.execute(sql`
        UPDATE professionalReviewSignals
        SET state = ${decision === "resolved" ? "corrected" : "invalidated"},
            updatedAt = NOW()
        WHERE authorizationId IN (
          SELECT authorizationId
          FROM professionalOperationalAlerts
          WHERE id = ${alertId}
        )
          AND originType = ${String(alert.originType)}
          AND originId = ${String(alert.originId ?? "")}
          AND state = 'open'
      `);
    }
  });

  return { id: alertId, state: decision };
}

async function requireActiveScope(
  db: any,
  professionalUserId: number,
  patientId: number
) {
  const scope = rows(
    await db.execute(sql`
      SELECT a.id
      FROM professionalPatientAuthorizations a
      INNER JOIN professionalPatientTrackings t ON t.authorizationId = a.id
      WHERE a.professionalUserId = ${professionalUserId}
        AND a.patientUserId = ${patientId}
        AND a.status = 'approved'
        AND t.status = 'active'
      LIMIT 1
    `)
  )[0];
  if (!scope) {
    throw new Error(
      "Esta ação está disponível somente durante acompanhamento ativo."
    );
  }
  return String(scope.id);
}

export async function createProfessionalOperationalRequest(
  professionalUserId: number,
  input: {
    patientId: number;
    type: "weigh_in" | "professional_request";
    title: string;
    dueAt: number;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Não foi possível criar a solicitação.");

  const authorizationId = await requireActiveScope(
    db,
    professionalUserId,
    input.patientId
  );
  const id = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO professionalOperationalRequests (
      id, authorizationId, professionalUserId,
      patientUserId, type, title, dueAt
    ) VALUES (
      ${id}, ${authorizationId}, ${professionalUserId},
      ${input.patientId}, ${input.type}, ${input.title},
      ${new Date(input.dueAt)}
    )
  `);
  return { id };
}

export async function respondToProfessionalOperationalRequest(
  actorUserId: number,
  requestId: string,
  responseReference: string
) {
  const db = await getDb();
  if (!db) throw new Error("Não foi possível registrar a resposta.");

  const request = rows(
    await db.execute(sql`
      SELECT id, professionalUserId, patientUserId
      FROM professionalOperationalRequests
      WHERE id = ${requestId} AND state = 'open'
      LIMIT 1
    `)
  )[0];
  if (!request) throw new Error("A solicitação não está mais disponível.");

  const professionalUserId = Number(request.professionalUserId);
  const patientUserId = Number(request.patientUserId);
  if (actorUserId !== professionalUserId && actorUserId !== patientUserId) {
    throw new Error("Você não tem permissão para responder esta solicitação.");
  }

  await db.transaction(async tx => {
    await tx.execute(sql`
      UPDATE professionalOperationalRequests
      SET state = 'answered',
          answeredAt = NOW(),
          closedAt = NOW(),
          closedByUserId = ${actorUserId},
          closureReason = 'response',
          responseReference = ${responseReference},
          updatedAt = NOW()
      WHERE id = ${requestId} AND state = 'open'
    `);
    await tx.execute(sql`
      UPDATE professionalOperationalAlerts
      SET state = 'inactive', updatedAt = NOW()
      WHERE professionalUserId = ${professionalUserId}
        AND originType = 'professional_request'
        AND originId = ${requestId}
        AND state = 'open'
    `);
  });

  return { id: requestId, state: "answered" as const };
}

export async function cancelProfessionalOperationalRequest(
  professionalUserId: number,
  actorUserId: number,
  requestId: string
) {
  const db = await getDb();
  if (!db) throw new Error("Não foi possível cancelar a solicitação.");

  await db.transaction(async tx => {
    const request = rows(
      await tx.execute(sql`
        SELECT id
        FROM professionalOperationalRequests
        WHERE id = ${requestId}
          AND professionalUserId = ${professionalUserId}
          AND state = 'open'
        LIMIT 1
      `)
    )[0];
    if (!request) throw new Error("A solicitação não está mais disponível.");

    await tx.execute(sql`
      UPDATE professionalOperationalRequests
      SET state = 'cancelled',
          closedAt = NOW(),
          closedByUserId = ${actorUserId},
          closureReason = 'cancelled',
          updatedAt = NOW()
      WHERE id = ${requestId} AND state = 'open'
    `);
    await tx.execute(sql`
      UPDATE professionalOperationalAlerts
      SET state = 'inactive', updatedAt = NOW()
      WHERE professionalUserId = ${professionalUserId}
        AND originType = 'professional_request'
        AND originId = ${requestId}
        AND state = 'open'
    `);
  });

  return { id: requestId, state: "cancelled" as const };
}

export async function registerProfessionalReviewSignal(
  professionalUserId: number,
  input: {
    patientId: number;
    originType: string;
    originId: string;
    reason: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Não foi possível registrar o sinal de revisão.");

  const authorizationId = await requireActiveScope(
    db,
    professionalUserId,
    input.patientId
  );
  const id = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO professionalReviewSignals (
      id, authorizationId, professionalUserId,
      patientUserId, originType, originId, reason
    ) VALUES (
      ${id}, ${authorizationId}, ${professionalUserId},
      ${input.patientId}, ${input.originType},
      ${input.originId}, ${input.reason}
    )
    ON DUPLICATE KEY UPDATE
      reason = VALUES(reason),
      state = 'open',
      updatedAt = NOW()
  `);
  return { id };
}
