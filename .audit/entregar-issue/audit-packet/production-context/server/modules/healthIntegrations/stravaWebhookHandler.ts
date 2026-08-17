/**
 * Strava Webhook Handler
 *
 * Implementa o protocolo de webhook push do Strava para sincronização em tempo real.
 * Documentação: https://developers.strava.com/docs/webhooks/
 *
 * Fluxo:
 * 1. GET  /api/health-integrations/strava/webhook → verificação de subscription (hub.challenge)
 * 2. POST /api/health-integrations/strava/webhook → recebe eventos de atividade em tempo real
 *
 * Quando o Strava envia um evento de criação/atualização de atividade, o sistema:
 * - Identifica o usuário pelo owner_id (athleteId armazenado no token)
 * - Dispara a sincronização incremental apenas para esse usuário
 * - Responde 200 imediatamente (o Strava exige resposta em < 2 segundos)
 */

import type { Request, Response } from "express";
import { healthIntegrationService } from "./stravaDetailSafeService";
import { listStoredStravaUserIds, loadStoredStravaTokenState } from "./strava/tokenStorage";
import { upsertHealthSyncedRecords } from "../../repositories/healthSyncedRecordsRepository";

// Tipos do payload de evento do Strava
type StravaWebhookEvent = {
  aspect_type: "create" | "update" | "delete";
  event_time: number;
  object_id: number;       // activityId ou athleteId
  object_type: "activity" | "athlete";
  owner_id: number;        // stravaAthleteId do usuário
  subscription_id: number;
  updates?: Record<string, unknown>;
};

function getVerifyToken() {
  return process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? "";
}

/**
 * GET /api/health-integrations/strava/webhook
 * Responde ao desafio de verificação do Strava ao registrar a subscription.
 */
export function handleStravaWebhookVerification(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const verifyToken = getVerifyToken();

  if (!verifyToken) {
    console.warn("[StravaWebhook] STRAVA_WEBHOOK_VERIFY_TOKEN não configurado — verificação rejeitada.");
    res.status(403).json({ error: "Webhook não configurado" });
    return;
  }

  if (mode === "subscribe" && token === verifyToken && challenge) {
    console.log("[StravaWebhook] Verificação de subscription aceita.");
    res.status(200).json({ "hub.challenge": challenge });
    return;
  }

  console.warn("[StravaWebhook] Verificação rejeitada: modo ou token inválido.", { mode, tokenMatch: token === verifyToken });
  res.status(403).json({ error: "Verificação inválida" });
}

/**
 * Encontra o userId interno a partir do stravaAthleteId (owner_id do evento).
 * Percorre todos os usuários com token Strava e compara o athleteId armazenado.
 */
async function findUserIdByStravaAthleteId(stravaAthleteId: number): Promise<number | null> {
  const userIds = await listStoredStravaUserIds();

  for (const userId of userIds) {
    const token = await loadStoredStravaTokenState(userId);
    if (token?.athleteId === stravaAthleteId) {
      return userId;
    }
  }

  return null;
}

async function persistWebhookSyncedRecords(userId: number, records: Awaited<ReturnType<typeof healthIntegrationService.sync>>["records"]) {
  await upsertHealthSyncedRecords(records.map(record => ({
    ...record,
    userId,
    provider: "strava" as const,
    source: "strava" as const,
    createdAt: Date.now(),
  })));
}

/**
 * POST /api/health-integrations/strava/webhook
 * Recebe eventos de atividade do Strava e dispara sincronização incremental.
 * Responde 200 imediatamente — o processamento ocorre em background.
 */
export function handleStravaWebhookEvent(req: Request, res: Response) {
  // O Strava exige resposta em < 2 segundos — respondemos imediatamente
  res.status(200).json({ status: "received" });

  const event = req.body as StravaWebhookEvent;

  // Só processamos criação e atualização de atividades
  if (event.object_type !== "activity" || event.aspect_type === "delete") {
    return;
  }

  const stravaAthleteId = event.owner_id;
  const activityId = event.object_id;

  console.log(`[StravaWebhook] Evento recebido: ${event.aspect_type} activity ${activityId} para atleta ${stravaAthleteId}`);

  // Processamento assíncrono em background
  void (async () => {
    try {
      const userId = await findUserIdByStravaAthleteId(stravaAthleteId);

      if (!userId) {
        console.warn(`[StravaWebhook] Atleta ${stravaAthleteId} não encontrado entre usuários conectados. Evento ignorado.`);
        return;
      }

      console.log(`[StravaWebhook] Sincronizando atividade ${activityId} para userId ${userId}...`);

      const result = await healthIntegrationService.sync(userId, { provider: "strava" });
      await persistWebhookSyncedRecords(userId, result.records);
      const summary = result.importedExercises;
      const count = summary ? summary.created + summary.updated : 0;
      console.log(`[StravaWebhook] Sincronização concluída para userId ${userId}: ${count} exercício(s) importado(s).`);
    } catch (error) {
      console.error(`[StravaWebhook] Erro ao processar evento para atleta ${stravaAthleteId}:`, error instanceof Error ? error.message : error);
    }
  })();
}