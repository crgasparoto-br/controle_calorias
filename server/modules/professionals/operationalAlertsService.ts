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
const rows = (result: unknown): Row[] =>
  Array.isArray(result)
    ? ((Array.isArray(result[0]) ? result[0] : result) as Row[])
    : [];
const stamp = (value: unknown) =>
  value ? new Date(String(value)).getTime() : null;

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
    period: { start: stamp(row.periodStart), end: stamp(row.periodEnd) },
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

async function upsertAlert(
  db: { execute: (query: unknown) => Promise<unknown> },
  input: {
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
  }
) {
  await db.execute(sql`INSERT INTO professionalOperationalAlerts
    (id,dedupeKey,type,professionalUserId,patientUserId,authorizationId,originType,originId,periodStart,periodEnd,reason,severity,state,suggestedAction)
    VALUES (${crypto.randomUUID()},${input.dedupeKey},${input.type},${input.professionalUserId},${input.patientUserId},${input.authorizationId},${input.originType},${input.originId ?? null},${input.periodStart ?? null},${input.periodEnd ?? null},${input.reason},${input.severity ?? "attention"},'open',${input.suggestedAction})
    ON DUPLICATE KEY UPDATE periodStart=VALUES(periodStart),periodEnd=VALUES(periodEnd),reason=VALUES(reason),severity=VALUES(severity),suggestedAction=VALUES(suggestedAction),state=IF(state='dismissed','dismissed','open'),updatedAt=NOW()`);
}

export async function evaluateProfessionalOperationalAlerts(
  professionalUserId: number,
  now = new Date()
) {
  const db = await getDb();
  if (!db)
    throw new Error("A central de pendências está temporariamente indisponível.");
  const scopes = rows(
    await db.execute(sql`SELECT a.id authorizationId,a.patientUserId,
    COALESCE(p.timezone,'America/Sao_Paulo') timezone,t.nextReviewAt
    FROM professionalPatientAuthorizations a
    INNER JOIN professionalPatientTrackings t ON t.authorizationId=a.id
    LEFT JOIN userProfiles p ON p.userId=a.patientUserId
    WHERE a.professionalUserId=${professionalUserId} AND a.status='approved' AND t.status='active'`)
  );
  const activeKeys = new Set<string>();
  for (const scope of scopes) {
    const authorizationId = String(scope.authorizationId);
    const patientUserId = Number(scope.patientUserId);
    const timeZone = String(scope.timezone || "America/Sao_Paulo");
    try {
      const period = getNoFoodRecordsWindow(now, timeZone);
      const meal = rows(
        await db.execute(sql`SELECT id,occurredAt FROM meals WHERE userId=${patientUserId} AND status='confirmed' AND occurredAt>=${period.start} AND occurredAt<=${period.end} ORDER BY occurredAt DESC LIMIT 1`)
      )[0];
      const noFoodKey = buildOperationalAlertDedupeKey(
        authorizationId,
        "no_food_records",
        `${getDateKeyInZone(period.start, timeZone)}:${getDateKeyInZone(period.end, timeZone)}`
      );
      if (!meal) {
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
      const requests = rows(
        await db.execute(sql`SELECT id,type,title,dueAt FROM professionalOperationalRequests WHERE authorizationId=${authorizationId} AND state='open' AND dueAt<=${now}`)
      );
      for (const request of requests) {
        const type =
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
      const signals = rows(
        await db.execute(sql`SELECT id,originType,originId,reason,createdAt FROM professionalReviewSignals WHERE authorizationId=${authorizationId} AND state='open'`)
      );
      for (const signal of signals) {
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
    await db.execute(sql`SELECT dedupeKey FROM professionalOperationalAlerts WHERE professionalUserId=${professionalUserId} AND state='open'`)
  );
  const obsolete = open
    .map(row => String(row.dedupeKey))
    .filter(key => !activeKeys.has(key));
  for (const key of obsolete)
    await db.execute(sql`UPDATE professionalOperationalAlerts SET state='inactive',updatedAt=NOW() WHERE professionalUserId=${professionalUserId} AND dedupeKey=${key} AND state='open'`);
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
    ? await db.execute(sql`SELECT * FROM professionalOperationalAlerts WHERE professionalUserId=${professionalUserId} AND patientUserId=${patientUserId} AND state='open' ORDER BY updatedAt DESC`)
    : await db.execute(sql`SELECT * FROM professionalOperationalAlerts WHERE professionalUserId=${professionalUserId} AND state='open' ORDER BY severity DESC,updatedAt DESC LIMIT 500`);
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
  const result = await db.execute(sql`UPDATE professionalOperationalAlerts SET state=${decision},resolvedByUserId=${actorUserId},resolvedAt=NOW(),resolutionNote=${note ?? null},updatedAt=NOW() WHERE id=${alertId} AND professionalUserId=${professionalUserId} AND state='open'`);
  const affected = Number(
    (result as { affectedRows?: number } | undefined)?.affectedRows ??
      (result as [{ affectedRows?: number }] | undefined)?.[0]?.affectedRows ??
      0
  );
  if (!affected) throw new Error("A pendência não está mais disponível.");
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
    await db.execute(sql`SELECT a.id FROM professionalPatientAuthorizations a INNER JOIN professionalPatientTrackings t ON t.authorizationId=a.id WHERE a.professionalUserId=${professionalUserId} AND a.patientUserId=${input.patientId} AND a.status='approved' AND t.status='active' LIMIT 1`)
  )[0];
  if (!scope)
    throw new Error(
      "Esta ação está disponível somente durante acompanhamento ativo."
    );
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO professionalOperationalRequests (id,authorizationId,professionalUserId,patientUserId,type,title,dueAt) VALUES (${id},${String(scope.id)},${professionalUserId},${input.patientId},${input.type},${input.title},${new Date(input.dueAt)})`);
  return { id };
}
