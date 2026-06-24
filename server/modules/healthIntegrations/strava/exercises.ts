import { getUserWhatsappConnection, logInferenceEvent } from "../../../db";
import { createExercise, listExercises, updateExercise } from "../../exercises/service";
import { tryCreateQuickEditLinkForExercise } from "../../quickEdit/service";
import { sendWhatsAppInteractiveUrlButtonMessage, sendWhatsAppTextMessage } from "../../whatsapp/webhookUtils";
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
}) {
  const emoji = getStravaActivityEmoji(input.activityType);
  const duration = `${formatStravaExerciseDuration(input.durationMinutes)} min`;
  return [
    `*Treino importado do Strava* ${emoji}`,
    "",
    `${input.activityType} — ${duration}`,
    `Calorias queimadas: ${input.caloriesBurned} kcal 🔥`,
    `Data: ${formatStravaExerciseDate(input.occurredAt)}`,
  ].join("\n");
}

async function sendStravaExerciseImportedWhatsAppMessage(userId: number, exerciseId: number, exercise: ReturnType<typeof toStravaExerciseInput>) {
  if (!exercise) return;

  try {
    const connection = await getUserWhatsappConnection(userId);
    if (!connection || connection.status !== "active") return;

    const message = buildStravaExerciseImportedWhatsAppMessage(exercise);
    const quickEditLink = await tryCreateQuickEditLinkForExercise({ userId, exerciseId });
    const response = quickEditLink?.url
      ? await sendWhatsAppInteractiveUrlButtonMessage(connection.phoneNumber, message, "Ver exercício", quickEditLink.url)
      : await sendWhatsAppTextMessage(
        connection.phoneNumber,
        `${message}\n\nAbra o app para revisar ou editar este exercício importado.`,
      );

    if (!response.ok || "usedFallback" in response && response.usedFallback) {
      logInferenceEvent({
        userId,
        origin: "admin",
        status: response.ok ? "warning" : "error",
        eventType: "strava.whatsapp_import_notification_failed",
        detail: `Falha ao enviar notificação de exercício Strava importado pelo WhatsApp: ${response.detail}`,
      });
    }
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "admin",
      status: "warning",
      eventType: "strava.whatsapp_import_notification_failed",
      detail: `Falha ao enviar notificação de exercício Strava importado pelo WhatsApp: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
    });
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

function hasReliableStravaCalories(exercise: { notes?: string | null } | undefined) {
  if (!exercise?.notes) return false;
  return /(?<!estimadas\s)Calorias:\s*\d/.test(exercise.notes);
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
  return {
    ...activity,
    ...detail,
    id: activity.id,
    caloriesOrigin: detailHasCalories ? "strava_detail" as const : detail.caloriesOrigin,
  } satisfies StravaActivity;
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
  const summary: StravaExerciseImportSummary = { created: 0, updated: 0, skipped: 0 };
  const detailState: StravaDetailFetchState = {
    accessToken: null,
    detailRequestLimit: getStravaMaxActivityDetailRequestsPerSync(),
    usedDetailRequests: 0,
    blockedFallbackReason: null,
  };

  for (const activity of activities) {
    const externalReference = `strava:${activity.id}`;
    const existingBeforeResolve = existingExercises.find(exercise => exercise.notes?.includes(externalReference));

    if (hasReliableStravaCalories(existingBeforeResolve)) {
      summary.skipped += 1;
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.detail_skipped_redundant",
        detail: "exercício já possui calorias confiáveis do Strava; detalhe não solicitado novamente nesta janela de overlap.",
      });
      continue;
    }

    const resolvedActivity = await resolveStravaActivityForImport(userId, activity, detailState);
    Object.assign(activity, resolvedActivity);

    const exerciseInput = toStravaExerciseInput(resolvedActivity);
    if (!exerciseInput) {
      summary.skipped += 1;
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "warning",
        eventType: "strava.import.exercise_skipped",
        detail: "exercício não criado porque duração ou calorias ficaram abaixo do mínimo após os fallbacks.",
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

    const existing = existingExercises.find(exercise => exercise.notes?.includes(externalReference));
    if (existing) {
      await updateExercise(userId, {
        exerciseId: existing.id,
        ...exerciseInput,
      });
      summary.updated += 1;
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.exercise_updated",
        detail: `exercício existente atualizado com origem de calorias ${metadata.caloriesOrigin ?? "sem_calorias"}.`,
      });
      await sendStravaExerciseImportedWhatsAppMessage(userId, existing.id, exerciseInput);
    } else {
      const created = await createExercise(userId, exerciseInput);
      existingExercises.push(created);
      summary.created += 1;
      logStravaImportEvent({
        userId,
        activityId: activity.id,
        status: "success",
        eventType: "strava.import.exercise_created",
        detail: `exercício criado com origem de calorias ${metadata.caloriesOrigin ?? "sem_calorias"}.`,
      });
      await sendStravaExerciseImportedWhatsAppMessage(userId, created.id, exerciseInput);
    }
  }

  return summary;
}
