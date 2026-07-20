import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, logPersistenceWarning } from "../../db";
import {
  buildOperationalAlertDedupeKey,
  getDateKeyInZone,
  getNoFoodRecordsWindow,
} from "./operationalAlertRules";

export const OPERATIONAL_ALERT_TYPES = [
  "no_food_records",
  "weigh_in_overdue",
  "goal_review_due",
  "professional_request_overdue",
  "record_requires_review",
] as const;
export type OperationalAlertType = (typeof OPERATIONAL_ALERT_TYPES)[number];
export type OperationalAlertState = "open" | "resolved" | "dismissed" | "inactive";
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
const timestamp = (value: unknown) =>
  value ? new Date(String(value)).getTime() : null;
const groupBy = (items: Row[], key: string) => {
  const grouped = new Map<string, Row[]>();
  for (const item of items) {
    const value = String(item[key]);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
};

function mapAlert(row: Row) {
  return {
    id: String(row.id),
    type: String(row.type) as OperationalAlertType,
    patientUserId: Number(row.patientUserId),
    authorizationId: String(row.authorizationId),
    origin: {
      type: String(row.originType),
      id: row.originId ? String(row.originId) : null,
    },
    period: {
      start: timestamp(row.periodStart),
      end: timestamp(row.periodEnd),
    },
    reason: String(row.reason),
    severity: String(row.severity) as "info" | "attention" | "urgent",
    state: String(row.state) as OperationalAlertState,
    suggestedAction: String(row.suggestedAction),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
    resolvedAt: timestamp(row.resolvedAt),
    resolvedByUserId: row.resolvedByUserId
      ? Number(row.resolvedByUserId)
      : null,
    resolutionNote: row.resolutionNote
      ? String(row.resolutionNote)
      : null,
  };
}

async function upsertAlert(
  db: { execute: (query: unknown) => Promise<unknown> },
  input: AlertInput
) {
  await db.execute(sql`INSERT INTO professionalOperationalAlerts
    (id,dedupeKey,type,professionalUserId,patientUserId,authorizationId,originType,originId,periodStart,periodEnd,reason,severity,state,suggestedAction)
    VALUES (${crypto.randomUUID()},${input.dedupeKey},${input.type},${input.professionalUserId},${input.patientUserId},${input.authorizationId},${input.originType},${input.originId ?? null},${input.periodStart ?? null},${input.periodEnd ?? null},${input.reason},${input.severity ?? "attention"},'open',${input.suggestedAction})
    ON DUPLICATE KEY UPDATE
      periodStart=VALUES(periodStart),periodEnd=VALUES(periodEnd),reason=VALUES(reason),
      severity=VALUES(severity),suggestedAction=VALUES(suggestedAction),
      state=IF(state IN ('resolved','dismissed'),state,'open'),updatedAt=NOW()`);
}

export async function evaluateProfessionalOperationalAlerts(
  professionalUserId: number,
  now = new Date()
) {
  const db = await getDb();
  if (!db)
    throw new Error("A central de pendências está temporariamente indisponível.");

  const [scopeResult, mealResult, requestResult, signalResult] =
    await Promise.all([
      db.execute(sql`SELECT a.id authorizationId,a.patientUserId,
        COALESCE(p.timezone,'America/Sao_Paulo') timezone,t.nextReviewAt
        FROM professionalPatientAuthorizations a
        INNER JOIN professionalPatientTrackings t ON t.authorizationId=a.id
        LEFT JOIN userProfiles p ON p.userId=a.patientUserId
        WHERE a.professionalUserId=${professionalUserId}
          AND a.status='approved' AND t.status='active'`),
      db.execute(sql`SELECT a.id authorizationId,MAX(m.occurredAt) lastMealAt
        FROM professionalPatientAuthorizations a
        INNER JOIN professionalPatientTrackings t ON t.authorizationId=a.id
        LEFT JOIN meals m ON m.userId=a.patientUserId AND m.status='confirmed'
        WHERE a.professionalUserId=${professionalUserId}
          AND a.status='approved' AND t.status='active'
        GROUP BY a.id`),
      db.execute(sql`SELECT r.id,r.authorizationId,r.type,r.title,r.dueAt
        FROM professionalOperationalRequests r
        INNER JOIN professionalPatientAuthorizations a ON a.id=r.authorizationId
        INNER JOIN professionalPatientTrackings t ON t.authorizationId=a.id
        WHERE a.professionalUserId=${professionalUserId}
          AND a.status='approved' AND t.status='active'
          AND r.state='open' AND r.dueAt<=${now}`),
      db.execute(sql`SELECT s.id,s.authorizationId,s.originType,s.originId,s.reason,s.createdAt
        FROM professionalReviewSignals s
        INNER JOIN professionalPatientAuthorizations a ON a.id=s.authorizationId
        INNER JOIN professionalPatientTrackings t ON t.authorizationId=a.id
        WHERE a.professionalUserId=${professionalUserId}
          AND a.status='approved' AND t.status='active' AND s.state='open'`),
    ]);

  const scopes = rows(scopeResult);
  const lastMealByAuthorization = new Map(
    rows(mealResult).map(row => [
      String(row.authorizationId),
      row.lastMealAt ? new Date(String(row.lastMealAt)) : null,
    ])
  );
  const requestsByAuthorization = groupBy(rows(requestResult), "authorizationId");
  const signalsByAuthorization = groupBy(rows(signalResult), "authorizationId");
  const activeKeys = new Set<string>();

  for (const scope of scopes) {
    const authorizationId = String(scope.authorizationId);
    const patientUserId = Number(scope.patientUserId);
    const timeZone = String(scope.timezone || "America/Sao_Paulo");
    try {
      const period = getNoFoodRecordsWindow(now, timeZone);
      const lastMeal = lastMealByAuthorization.get(authorizationId);
      const noFoodKey = buildOperationalAlertDedupeKey(
        authorizationId,
        "no_food_records",
        `${getDateKeyInZone(period.start, timeZone)}:${getDateKeyInZone(period.end, timeZone)}`
      );
      if (!lastMeal || lastMeal < period.start || lastMeal > period.end) {
        activeKeys.add(noFoodKey);
        await upsertAlert(db, {
          dedupeKey: noFoodKey,
          type: "no_food_records",
          professionalUserId,
          patientUserId,
          authorizationId,
          originType: "meals",
          periodStart: period.start,
          periodEnd: period.end,
          reason: `Nenhum registro alimentar confirmado nos últimos 3 dias corridos (${timeZone}).`,
          suggestedAction:
            "Revisar o acompanhamento e, se necessário, entrar em contato com o paciente.",
        });
      }

      if (scope.nextReviewAt && new Date(String(scope.nextReviewAt)) <= now) {
        const originId = new Date(String(scope.nextReviewAt)).toISOString();
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
          periodEnd: new Date(String(scope.nextReviewAt)),
          reason:
            "A data de revisão definida para o acompanhamento foi alcançada.",
          suggestedAction: "Registrar a revisão ou reagendar a próxima data.",
        });
      }

      for (const request of requestsByAuthorization.get(authorizationId) ?? []) {
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
          periodEnd: new Date(String(request.dueAt)),
          reason: `Prazo vencido: ${String(request.title)}.`,
          suggestedAction:
            type === "weigh_in_overdue"
              ? "Solicitar a pesagem ou encerrar a solicitação."
              : "Revisar a solicitação e registrar resposta, cancelamento ou dispensa.",
        });
      }

      for (const signal of signalsByAuthorization.get(authorizationId) ?? []) {
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
    } catch (error) {
      logPersistenceWarning("professional_operational_alert_evaluation", error);
    }
  }

  const open = rows(
    await db.execute(sql`SELECT dedupeKey FROM professionalOperationalAlerts
      WHERE professionalUserId=${professionalUserId} AND state='open'`)
  );
  const obsolete = open
    .map(row => String(row.dedupeKey))
    .filter(key => !activeKeys.has(key));
  for (const key of obsolete) {
    await db.execute(sql`UPDATE professionalOperationalAlerts
      SET state='inactive',updatedAt=NOW()
      WHERE professionalUserId=${professionalUserId}
        AND dedupeKey=${key} AND state='open'`);
  }
  return { evaluatedPatients: scopes.length, activeAlerts: activeKeys.size };
}

export async function listProfessionalOperationalAlerts(
  professionalUserId: number,
  patientUserId?: number
) {
  await evaluateProfessionalOperationalAlerts(professionalUserId);
  const db = await getDb();
  if (!db) return [];
  const result = patientUserId
    ? await db.execute(sql`SELECT * FROM professionalOperationalAlerts
        WHERE professionalUserId=${professionalUserId}
          AND patientUserId=${patientUserId} AND state='open'
        ORDER BY updatedAt DESC`)
    : await db.execute(sql`SELECT * FROM professionalOperationalAlerts
        WHERE professionalUserId=${professionalUserId} AND state='open'
        ORDER BY severity DESC,updatedAt DESC LIMIT 500`);
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
    await db.execute(sql`SELECT id,type,originType,originId FROM professionalOperationalAlerts
      WHERE id=${alertId} AND professionalUserId=${professionalUserId} AND state='open'
      LIMIT 1`)
  )[0];
  if (!alert) throw new Error("A pendência não está mais disponível.");

  await db.transaction(async tx => {
    await tx.execute(sql`UPDATE professionalOperationalAlerts
      SET state=${decision},resolvedByUserId=${actorUserId},resolvedAt=NOW(),
        resolutionNote=${note ?? null},updatedAt=NOW()
      WHERE id=${alertId} AND professionalUserId=${professionalUserId} AND state='open'`);
    if (String(alert.originType) === "professional_request" && alert.originId) {
      await tx.execute(sql`UPDATE professionalOperationalRequests
        SET state=${decision === "resolved" ? "answered" : "dismissed"},
          answeredAt=${decision === "resolved" ? new Date() : null},closedAt=NOW(),updatedAt=NOW()
        WHERE id=${String(alert.originId)} AND professionalUserId=${professionalUserId} AND state='open'`);
    }
    if (String(alert.type) === "record_requires_review") {
      await tx.execute(sql`UPDATE professionalReviewSignals
        SET state=${decision === "resolved" ? "corrected" : "invalidated"},updatedAt=NOW()
        WHERE authorizationId IN (
          SELECT authorizationId FROM professionalOperationalAlerts WHERE id=${alertId}
        ) AND originType=${String(alert.originType)} AND originId=${String(alert.originId ?? "")}
          AND state='open'`);
    }
  });
  return { id: alertId, state: decision };
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
  const scope = rows(
    await db.execute(sql`SELECT a.id FROM professionalPatientAuthorizations a
      INNER JOIN professionalPatientTrackings t ON t.authorizationId=a.id
      WHERE a.professionalUserId=${professionalUserId}
        AND a.patientUserId=${input.patientId}
        AND a.status='approved' AND t.status='active' LIMIT 1`)
  )[0];
  if (!scope)
    throw new Error(
      "Esta ação está disponível somente durante acompanhamento ativo."
    );
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO professionalOperationalRequests
    (id,authorizationId,professionalUserId,patientUserId,type,title,dueAt)
    VALUES (${id},${String(scope.id)},${professionalUserId},${input.patientId},${input.type},${input.title},${new Date(input.dueAt)})`);
  return { id };
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
  const scope = rows(
    await db.execute(sql`SELECT a.id FROM professionalPatientAuthorizations a
      INNER JOIN professionalPatientTrackings t ON t.authorizationId=a.id
      WHERE a.professionalUserId=${professionalUserId}
        AND a.patientUserId=${input.patientId}
        AND a.status='approved' AND t.status='active' LIMIT 1`)
  )[0];
  if (!scope)
    throw new Error(
      "O sinal só pode ser registrado durante acompanhamento ativo."
    );
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO professionalReviewSignals
    (id,authorizationId,professionalUserId,patientUserId,originType,originId,reason)
    VALUES (${id},${String(scope.id)},${professionalUserId},${input.patientId},${input.originType},${input.originId},${input.reason})
    ON DUPLICATE KEY UPDATE reason=VALUES(reason),state='open',updatedAt=NOW()`);
  return { id };
}
