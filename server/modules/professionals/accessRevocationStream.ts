import { sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { sdk } from "../../_core/sdk";
import { getDb } from "../../db";
import {
  professionalPatientContextResourceSchema,
  type ProfessionalPatientContextInput,
} from "./patientContextSchemas";
import { getProfessionalPatientContext } from "./patientContextService";
import {
  subscribeProfessionalAccessRevocations,
  type ProfessionalAccessRevokedEvent,
} from "./accessRevocationEvents";

const HEARTBEAT_INTERVAL_MS = 15_000;
const CROSS_INSTANCE_CHECK_INTERVAL_MS = 1_000;

type AuthenticatedUser = { id: number };
type RevocationSnapshot = Pick<
  ProfessionalAccessRevokedEvent,
  "patientUserId" | "occurredAt"
>;

type AccessRevocationStreamDependencies = {
  authenticate: (req: Request, res: Response) => Promise<AuthenticatedUser | null>;
  authorize: (
    professionalUserId: number,
    input: ProfessionalPatientContextInput
  ) => Promise<unknown>;
  subscribe: typeof subscribeProfessionalAccessRevocations;
  findPersistedRevocation: (
    professionalUserId: number,
    patientUserId: number
  ) => Promise<RevocationSnapshot | null>;
  heartbeatIntervalMs?: number;
  crossInstanceCheckIntervalMs?: number;
};

function rows(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Array<
    Record<string, unknown>
  >;
}

function timestamp(value: unknown) {
  if (!value) return Date.now();
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
}

async function findPersistedRevocation(
  professionalUserId: number,
  patientUserId: number
): Promise<RevocationSnapshot | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`
    SELECT status, revokedAt
    FROM professionalPatientAuthorizations
    WHERE professionalUserId = ${professionalUserId}
      AND patientUserId = ${patientUserId}
    ORDER BY approvedAt DESC, requestedAt DESC, id DESC
    LIMIT 1
  `);
  const authorization = rows(result)[0];
  if (!authorization || String(authorization.status) !== "approved") {
    return {
      patientUserId,
      occurredAt: timestamp(authorization?.revokedAt),
    };
  }
  return null;
}

function positiveInteger(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function writeEvent(
  res: Response,
  eventName: string,
  event: RevocationSnapshot
) {
  res.write(`id: ${event.occurredAt}\n`);
  res.write(`event: ${eventName}\n`);
  res.write(
    `data: ${JSON.stringify({ patientId: event.patientUserId, occurredAt: event.occurredAt })}\n\n`
  );
  (res as Response & { flush?: () => void }).flush?.();
}

export function createProfessionalAccessRevocationStreamHandler(
  dependencies: AccessRevocationStreamDependencies
) {
  return async function handleProfessionalAccessRevocationStream(
    req: Request,
    res: Response
  ) {
    const patientId = positiveInteger(req.query.patientId);
    const resource = professionalPatientContextResourceSchema.safeParse(
      req.query.resource
    );
    if (!patientId || !resource.success) {
      res.status(400).json({ error: "Invalid professional access stream." });
      return;
    }

    const user = await dependencies.authenticate(req, res);
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    try {
      await dependencies.authorize(user.id, {
        patientId,
        resource: resource.data,
      });
    } catch {
      // Keep this auxiliary boundary indistinguishable. The canonical context
      // query remains responsible for the actionable authorization message.
      res.status(503).json({ error: "Professional access stream unavailable." });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write("retry: 3000\n");
    res.write("event: ready\n");
    res.write(`data: ${JSON.stringify({ patientId })}\n\n`);

    let closed = false;
    let checkingPersistedState = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let crossInstanceCheck: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: () => void = () => undefined;

    const close = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (crossInstanceCheck) clearInterval(crossInstanceCheck);
      unsubscribe();
    };
    const deliverRevocation = (event: RevocationSnapshot) => {
      if (closed) return;
      writeEvent(res, "access_revoked", event);
      close();
      res.end();
    };

    unsubscribe = dependencies.subscribe(user.id, patientId, event => {
      deliverRevocation(event);
    });
    heartbeat = setInterval(
      () => {
        if (!closed) res.write(": keep-alive\n\n");
      },
      dependencies.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    );
    crossInstanceCheck = setInterval(() => {
      if (closed || checkingPersistedState) return;
      checkingPersistedState = true;
      void dependencies
        .findPersistedRevocation(user.id, patientId)
        .then(event => {
          if (event) deliverRevocation(event);
        })
        .finally(() => {
          checkingPersistedState = false;
        });
    }, dependencies.crossInstanceCheckIntervalMs ?? CROSS_INSTANCE_CHECK_INTERVAL_MS);

    req.once("close", close);
    res.once("close", close);
  };
}

export const handleProfessionalAccessRevocationStream =
  createProfessionalAccessRevocationStreamHandler({
    authenticate: async req => {
      try {
        return await sdk.authenticateRequest(req);
      } catch {
        return null;
      }
    },
    authorize: getProfessionalPatientContext,
    subscribe: subscribeProfessionalAccessRevocations,
    findPersistedRevocation,
  });
