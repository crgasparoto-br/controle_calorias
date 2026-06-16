import { getUserWhatsappConnection, logInferenceEvent } from "../../../db";
import { requireWhatsAppSendConfig } from "../../../whatsappConfig";
import { createExercise, listExercises, updateExercise } from "../../exercises/service";
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

async function sendStravaExerciseImportedWhatsAppMessage(userId: number, exercise: ReturnType<typeof toStravaExerciseInput>) {
  if (!exercise) return;

  try {
    const connection = await getUserWhatsappConnection(userId);
    if (!connection || connection.status !== "active") return;

    const config = await requireWhatsAppSendConfig();
    const response = await fetch(`https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: connection.phoneNumber,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: buildStravaExerciseImportedWhatsAppMessage(exercise),
          },
          action: {
            buttons: [
              {
                type: "reply",
                reply: {
                  id: "daily_summary",
                  title: "Ver resumo do dia",
                },
              },
            ],
          },
        },
      }),
    });

    if (!response.ok) {
      logInferenceEvent({
        userId,
        origin: "admin",
        status: "warning",
        eventType: "strava.whatsapp_import_notification_failed",
        detail: `Falha ao enviar notificação de exercício Strava importado pelo WhatsApp: Meta retornou ${response.status} ${response.statusText}.`,
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

export async function upsertStravaActivitiesAsExercises(userId: number, activities: StravaActivity[]): Promise<StravaExerciseImportSummary> {
  const existingExercises = await listExercises(userId);
  const summary: StravaExerciseImportSummary = { created: 0, updated: 0, skipped: 0 };

  for (const activity of activities) {
    const exerciseInput = toStravaExerciseInput(activity);
    if (!exerciseInput) {
      summary.skipped += 1;
      continue;
    }

    const externalReference = `strava:${activity.id}`;
    const existing = existingExercises.find(exercise => exercise.notes?.includes(externalReference));
    if (existing) {
      await updateExercise(userId, {
        exerciseId: existing.id,
        ...exerciseInput,
      });
      summary.updated += 1;
    } else {
      const created = await createExercise(userId, exerciseInput);
      existingExercises.push(created);
      summary.created += 1;
      await sendStravaExerciseImportedWhatsAppMessage(userId, exerciseInput);
    }
  }

  return summary;
}
