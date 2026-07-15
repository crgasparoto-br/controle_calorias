import { getUserWhatsappConnection, logInferenceEvent } from "../../../db";
import { createExercise, listExercises, updateExercise } from "../../exercises/service";
import { tryCreateQuickEditLinkForExercise } from "../../quickEdit/service";
import { textReply, withCtaUrl } from "../../whatsapp/replyContract";
import { sendWhatsAppLogicalReply } from "../../whatsapp/replyTransport";
import { buildWhatsAppCanonicalExerciseReply } from "../../whatsapp/domainReplyFormatters";
import {
  fetchStravaActivityDetail,
  getStravaMaxActivityDetailRequestsPerSync,
  shouldFetchStravaActivityDetail,
} from "./activities";
import {
  formatDistanceKm,
  formatPace,
  formatSpeedKmH,
  getStravaActivityEmoji,
  getStravaActivityMetadata,
  getStravaActivityType,
  getStravaCaloriesBurned,
} from "./activityUtils";
import { STRAVA_ACTIVITY_NOTE_PREFIX } from "./constants";
import { ensureValidStravaToken } from "./oauth";
import { StravaRateLimitError, getStravaGlobalCooldownError, setStravaUserCooldown } from "./rateLimit";
import type { StravaActivity, StravaExerciseImportSummary } from "./types";

const notifiedStravaActivityKeys = new Set<string>();

function buildStravaNotificationKey(userId: number, externalId: string | number) {
  return `${userId}:strava:${String(externalId).trim().toLowerCase()}`;
}

export function __resetStravaWhatsAppNotificationIdempotencyForTests() {
  notifiedStravaActivityKeys.clear();
}

export function getStravaExerciseNote(activity: StravaActivity) {
  const metadata = getStravaActivityMetadata(activity);
  const activityType = getStravaActivityType(activity);
  const fragments = [`${STRAVA_ACTIVITY_NOTE_PREFIX}. Referencia externa: strava:${activity.id}.`];

  if (metadata.sportType !== activityType) fragments.push(`Tipo Strava: ${metadata.sportType}.`);
  if (metadata.distanceMeters) fragments.push(`Distancia: ${formatDistanceKm(metadata.distanceMeters)}.`);
  if (metadata.calories) {
    const label = metadata.estimatedCalories ? "Calorias estimadas" : "Calorias";
    fragments.push(`${label}: ${metadata.calories} kcal.`);
  }
  if (metadata.totalElevationGainMeters) fragments.push(`Elevacao: ${Math.round(metadata.totalElevationGainMeters)} m.`);
  if (metadata.averageHeartRate) fragments.push(`FC media: ${Math.round(metadata.averageHeartRate)} bpm.`);
  if (metadata.averageSpeedMetersPerSecond) {
    const pace = formatPace(metadata.averageSpeedMetersPerSecond);
    fragments.push(pace ? `Ritmo medio: ${pace}.` : `Velocidade media: ${formatSpeedKmH(metadata.averageSpeedMetersPerSecond)}.`);
  }

  return fragments.join(" ").slice(0, 500);
}

export function toStravaExerciseInput(activity: StravaActivity) {
  const durationMinutes = Math.max(Math.round((activity.moving_time ?? 0) / 60), 0);
  const caloriesBurned = getStravaCaloriesBurned(activity);
  if (durationMinutes < 1 || caloriesBurned < 1) return null;

  return {
    activityType: getStravaActivityType(activity),
    durationMinutes,
    caloriesBurned,
    occurredAt: activity.start_date,
    notes: getStravaExerciseNote(activity),
  };
}

export function formatStravaExerciseDuration(minutes: number) {
  return String(Math.max(Math.round(minutes), 0)).padStart(2, "0");
}

export function formatStravaExerciseDate(occurredAt: string) {
  return new Date(occurredAt).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function buildStravaExerciseImportedWhatsAppMessage(input: {
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  occurredAt: string;
  notes?: string | null;
}) {
  return buildWhatsAppCanonicalExerciseReply({
    activity: input.activityType,
    durationMinutes: input.durationMinutes,
    calories: input.caloriesBurned,
    occurredAtLabel: formatStravaExerciseDate(input.occurredAt),
    caloriesEstimated: /calorias estimadas/i.test(input.notes ?? ""),
  });
}

async function sendStravaExerciseImportedWhatsAppMessage(userId: number, externalId: string, exerciseId: number, exercise: ReturnType<typeof toStravaExerciseInput>) {
  if (!exercise) return "skipped" as const;

  const notificationKey = buildStravaNotificationKey(userId, externalId);
  if (notifiedStravaActivityKeys.has(notificationKey)) {
    logInferenceEvent({
      userId,
      origin: "admin",
      status: "success",
      eventType: "strava.whatsapp_import_notification_skipped_idempotent",
      detail: "Notificação de exercício Strava importado ignorada porque a atividade externa já foi notificada nesta execução.",
    });
    return "skipped" as const;
  }

  notifiedStravaActivityKeys.add(notificationKey);

  try {
    const connection = await getUserWhatsappConnection(userId);
    if (!connection || connection.status !== "active") {
      notifiedStravaActivityKeys.delete(notificationKey);
      logInferenceEvent({
        userId,
        origin: "admin",
        status: "success",
        eventType: "strava.whatsapp_import_notification_skipped",
        detail: "Notificação de exercício Strava importado ignorada porque o usuário não possui WhatsApp ativo.",
      });
      return "skipped" as const;
    }

    const message = buildStravaExerciseImportedWhatsAppMessage(exercise);
    const quickEditLink = await tryCreateQuickEditLinkForExercise({ userId, exerciseId });
    const logicalReply = quickEditLink?.url
      ? withCtaUrl(textReply(message), { buttonText: "Ver exercício", url: quickEditLink.url })
      : textReply(`${message}\n\nAbra o app para revisar ou editar este exercício importado.`);
    const delivery = await sendWhatsAppLogicalReply(connection.phoneNumber, logicalReply);
    const response = {
      ok: delivery.primaryOk,
      detail: delivery.sends.find(send => !send.ok)?.detail ?? "Notificação enviada.",
    };

    if (!response.ok) {
      notifiedStravaActivityKeys.delete(notificationKey);
    }

    if (!response.ok) {
      logInferenceEvent({
        userId,
        origin: "admin",
        status: "error",
        eventType: "strava.whatsapp_import_notification_failed",
        detail: "Falha no transporte central da notificação de exercício Strava.",
      });
    }

    return response.ok ? "sent" as const : "failed" as const;
  } catch (error) {
    notifiedStravaActivityKeys.delete(notificationKey);
    logInferenceEvent({
      userId,
      origin: "admin",
      status: "warning",
      eventType: "strava.whatsapp_import_notification_failed",
      detail: "Falha ao enviar notificação de exercício Strava importado pelo WhatsApp.",
    });
    return "failed" as const;
  }
}

function logStravaImportEvent(input: {
  userId: number;
  activityId: number;
  status: "success" | "warning" | "error";
  eventType: string;
  detail: string;
}) {
  logInferenceEvent({
    userId: input.userId,
    origin: "admin",
    status: input.status,
    eventType: input.eventType,
    detail: `Atividade Strava ${input.activityId}: ${input.detail}`,
  });
}

function parseReliableStravaCalories(exercise: { notes?: string | null } | undefined) {
  if (!exercise?.notes) return null;
  const match = exercise.notes.match(/(?<!estimadas\s)Calorias:\s*(\d+)/);
  if (!match?.[1]) return null;

  const calories = Number(match[1]);
  return Number.isFinite(calories) && calories > 0 ? calories : null;
}

function getStravaActivityMinimumImportSkipReason(activity: StravaActivity) {
  if (!Number.isFinite(activity.id)) return "id da atividade ausente ou inválido";
  if (!activity.start_date) return "data de início ausente";

  const durationMinutes = Math.max(Math.round((activity.moving_time ?? 0) / 60), 0);
  if (durationMinutes < 1) return "duração menor que 1 minuto";

  return null;
}

type StravaDetailFetchState = {
  accessToken: string | null;
  detailRequestLimit: number;
  usedDetailRequests: number;
  blockedFallbackReason: string | null;
};

async function getStravaDetailAccessToken(userId: number, state: StravaDetailFetchState) {
  if (state.accessToken) return state.accessToken;

  const token = await ensureValidStravaToken(userId);
  state.accessToken = token.accessToken;
  return state.accessToken;
}

function withStravaSummaryCaloriesOrigin(activity: StravaActivity): StravaActivity {
  if (typeof activity.calories === "number" && activity.calories > 0 && !activity.caloriesOrigin) {
    return { ...activity, caloriesOrigin: "strava_summary" };
  }

  return activity;
}

function mergeStravaActivityDetail(activity: StravaActivity, detail: StravaActivity) {
  const detailHasCalories = typeof detail.calories === "number" && detail.calories > 0;
  const summaryHasCalories = typeof activity.calories === "number" && activity.calories > 0;

  // Prioridade: calorias do detalhe > calorias da listagem (summary) > estimativa local
  // O detalhe retorna as calorias reais do dispositivo (Garmin, Apple Watch etc.).
  // A listagem retorna estimativa do Strava baseada no perfil do atleta.
  // A estimativa local é usada apenas como último recurso.
  const merged = { ...activity, ...detail, id: activity.id } satisfies StravaActivity;

  if (detailHasCalories) {
    return { ...merged, caloriesOrigin: "strava_detail" as const };
  }

  if (summaryHasCalories) {
    // Usa as calorias da listagem como fallback quando o detalhe não retornou calorias
    return { ...merged, calories: activity.calories, caloriesOrigin: "strava_summary" as const };
  }

  return { ...merged, caloriesOrigin: detail.caloriesOrigin };
}

async function resolveStravaActivityForImport(userId: number, activity: StravaActivity, state: StravaDetailFetchState) {
  logStravaImportEvent({
    userId,
    activityId: activity.id,
    status: "success",
    eventType: "strava.import.activity_listed",
    detail: "atividade recebida da listagem e avaliada para importação.",
  });

  const skipReason = getStravaActivityMinimumImportSkipReason(activity);
  if (skipReason) {
    logStravaImportEvent({
      userId,
      activityId: activity.id,
      status: "warning",
      eventType: "strava.import.activity_skipped",
      detail: `detalhe não solicitado porque a atividade não tem dados mínimos: ${skipReason}.`,
    });
    return activity;
  }

  if (!shouldFetchStravaActivityDetail(activity)) {
    return withStravaSummaryCaloriesOrigin(activity);
  }

  if (!state.blockedFallbackReason && getStravaGlobalCooldownError()) {
    state.blockedFallbackReason = "uso da API do Strava aproximando-se do limite; proteção preventiva ativada";
  }

  if (state.blockedFallbackReason) {
    logStravaImportEvent({
      userId,
      activityId: activity.id,
      status: "warning",
      eventType: "strava.import.detail_skipped",
      detail: `detalhe não solicitado por proteção ativa; usando fallback disponível. Motivo: ${state.blockedFallbackReason}.`,
    });
    return withStravaSummaryCaloriesOrigin(activity);
  }

  if (state.usedDetailRequests >= state.detailRequestLimit) {
    logStravaImportEvent({
      userId,
      activityId: activity.id,
      status: "warning",
      eventType: "strava.import.detail_skipped",
      detail: `limite de ${state.detailRequestLimit} detalhe(s) por sincronização atingido; usando fallback disponível.`,
    });
    return withStravaSummaryCaloriesOrigin(activity);
  }

  state.usedDetailRequests += 1;
  logStravaImportEvent({
    userId,
    activityId: activity.id,
    status: "success",
    eventType: "strava.import.detail_requested",
    detail: "detalhe solicitado usando o activity.id retornado pela listagem.",
  });

  try {
    const accessToken = await getStravaDetailAccessToken(userId, state);
    const detail = await fetchStravaActivityDetail(accessToken, activity.id);
    if (!detail) {
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "warning",
        eventType: "strava.import.detail_missing",
        detail: "detalhe não retornou dados utilizáveis; usando fallback disponível.",
      });
      return withStravaSummaryCaloriesOrigin(activity);
    }

    const merged = mergeStravaActivityDetail(activity, detail);
    logStravaImportEvent({
      userId,
      activityId: activity.id,
      status: "success",
      eventType: "strava.import.detail_received",
      detail: typeof detail.calories === "number" && detail.calories > 0
        ? "detalhe retornou calorias e terá prioridade sobre as demais fontes."
        : "detalhe retornou sem calorias; próxima fonte disponível será usada.",
    });
    return merged;
  } catch (error) {
    if (error instanceof StravaRateLimitError) {
      setStravaUserCooldown(userId, error.retryAfterMs);
      state.blockedFallbackReason = "limite de requisições do Strava atingido";
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "warning",
        eventType: "strava.import.detail_rate_limited",
        detail: "Strava retornou 429; novas chamadas de detalhe foram bloqueadas e o fallback disponível será usado.",
      });
      return withStravaSummaryCaloriesOrigin(activity);
    }

    logStravaImportEvent({
      userId,
      activityId: activity.id,
      status: "warning",
      eventType: "strava.import.detail_failed",
      detail: `falha recuperável ao buscar detalhe; usando fallback disponível. ${error instanceof Error ? error.message : "Erro desconhecido"}.`,
    });
    return withStravaSummaryCaloriesOrigin(activity);
  }
}

export async function upsertStravaActivitiesAsExercises(userId: number, activities: StravaActivity[]): Promise<StravaExerciseImportSummary> {
  const existingExercises = await listExercises(userId);
  const summary: StravaExerciseImportSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    notificationsSent: 0,
    notificationsSkipped: 0,
  };
  const detailState: StravaDetailFetchState = {
    accessToken: null,
    detailRequestLimit: getStravaMaxActivityDetailRequestsPerSync(),
    usedDetailRequests: 0,
    blockedFallbackReason: null,
  };

  for (const activity of activities) {
    const externalId = String(activity.id);
    const externalReference = `strava:${externalId}`;
    const existingBeforeResolve = existingExercises.find(exercise =>
      exercise.externalProvider === "strava" && exercise.externalId === externalId.toLowerCase()
      || exercise.notes?.includes(externalReference)
    );
    const reliableCalories = parseReliableStravaCalories(existingBeforeResolve);

    if (reliableCalories !== null) {
      Object.assign(activity, {
        calories: reliableCalories,
        caloriesOrigin: "strava_summary" as const,
      });
      summary.skipped += 1;
      summary.notificationsSkipped += 1;
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.detail_skipped_redundant",
        detail: "exercício já possui calorias confiáveis do Strava; detalhe não solicitado novamente nesta janela de overlap.",
      });
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.notification_skipped_idempotent",
        detail: "notificação WhatsApp ignorada porque a atividade já havia sido importada.",
      });
      continue;
    }

    const resolvedActivity = await resolveStravaActivityForImport(userId, activity, detailState);
    Object.assign(activity, resolvedActivity);

    const exerciseInput = toStravaExerciseInput(resolvedActivity);
    if (!exerciseInput) {
      summary.skipped += 1;
      summary.notificationsSkipped += 1;
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "warning",
        eventType: "strava.import.exercise_skipped",
        detail: "exercício não criado porque duração ou calorias ficaram abaixo do mínimo após os fallbacks.",
      });
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.notification_skipped_no_exercise",
        detail: "notificação WhatsApp ignorada porque nenhum exercício foi persistido.",
      });
      continue;
    }

    const metadata = getStravaActivityMetadata(resolvedActivity);
    logStravaImportEvent({
      userId,
      activityId: activity.id,
      status: metadata.estimatedCalories ? "warning" : "success",
      eventType: "strava.import.calories_selected",
      detail: `origem escolhida: ${metadata.caloriesOrigin ?? "sem_calorias"}; calorias: ${metadata.calories ?? 0} kcal.`,
    });

    if (existingBeforeResolve) {
      const updated = await updateExercise(userId, {
        exerciseId: existingBeforeResolve.id,
        ...exerciseInput,
        externalProvider: "strava",
        externalId,
      });
      const updatedIndex = existingExercises.findIndex(exercise => exercise.id === updated.id);
      if (updatedIndex >= 0) {
        existingExercises[updatedIndex] = updated;
      }
      summary.updated += 1;
      summary.notificationsSkipped += 1;
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.exercise_updated",
        detail: `exercício existente atualizado com origem de calorias ${metadata.caloriesOrigin ?? "sem_calorias"}.`,
      });
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.notification_skipped_idempotent",
        detail: "notificação WhatsApp ignorada porque a atividade já possuía exercício persistido.",
      });
      continue;
    }

    const persisted = await createExercise(userId, {
      ...exerciseInput,
      externalProvider: "strava",
      externalId,
    });
    const importStatus = persisted.externalImportStatus ?? "created";
    const persistedIndex = existingExercises.findIndex(exercise => exercise.id === persisted.id);
    if (persistedIndex >= 0) {
      existingExercises[persistedIndex] = persisted;
    } else {
      existingExercises.push(persisted);
    }

    if (importStatus === "created") {
      summary.created += 1;
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.exercise_created",
        detail: `exercício criado com origem de calorias ${metadata.caloriesOrigin ?? "sem_calorias"}.`,
      });
      const notificationStatus = await sendStravaExerciseImportedWhatsAppMessage(userId, externalId, persisted.id, exerciseInput);
      if (notificationStatus === "sent") {
        summary.notificationsSent += 1;
        logStravaImportEvent({
          userId,
          activityId: activity.id,
          status: "success",
          eventType: "strava.import.notification_sent",
          detail: "notificação WhatsApp enviada para o exercício recém-criado.",
        });
      } else {
        summary.notificationsSkipped += 1;
      }
      continue;
    }

    summary.updated += 1;
    summary.notificationsSkipped += 1;
    logStravaImportEvent({
      userId,
      activityId: activity.id,
      status: "success",
      eventType: "strava.import.exercise_updated",
      detail: `exercício existente atualizado com origem de calorias ${metadata.caloriesOrigin ?? "sem_calorias"}.`,
    });
    logStravaImportEvent({
      userId,
      activityId: activity.id,
      status: "success",
      eventType: "strava.import.notification_skipped_idempotent",
      detail: "notificação WhatsApp ignorada porque a atividade já possuía exercício persistido.",
    });
  }

  return summary;
}
