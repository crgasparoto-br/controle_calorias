import { listUserWeightEntries, updateUserCurrentWeight } from "../../db";

const TIMESTAMP_TOLERANCE_MS = 1_000;
const WEIGHT_TOLERANCE_KG = 0.001;

function sameWeightEntry(
  entry: { measuredAt: Date | number | string; weightKg: number },
  occurredAt: Date,
  weightKg: number,
) {
  return Math.abs(new Date(entry.measuredAt).getTime() - occurredAt.getTime()) <= TIMESTAMP_TOLERANCE_MS
    && Math.abs(Number(entry.weightKg) - weightKg) <= WEIGHT_TOLERANCE_KG;
}

/**
 * Persiste um peso do WhatsApp no máximo uma vez para o mesmo usuário,
 * instante lógico e valor. O lease do inbound evita concorrência normal; esta
 * verificação protege retries após a mutação ter sido concluída e o envio da
 * resposta ter falhado.
 */
export async function ensureWhatsAppWeightEntry(
  userId: number,
  input: { weightKg: number; measuredAt: Date; notes?: string },
) {
  const existing = (await listUserWeightEntries(userId))
    .find(entry => sameWeightEntry(entry, input.measuredAt, input.weightKg));
  if (existing) {
    return { entry: existing, created: false } as const;
  }

  await updateUserCurrentWeight(userId, input);
  const persisted = (await listUserWeightEntries(userId))
    .find(entry => sameWeightEntry(entry, input.measuredAt, input.weightKg));

  return {
    entry: persisted ?? {
      id: 0,
      userId,
      weightKg: input.weightKg,
      measuredAt: input.measuredAt,
      notes: input.notes ?? null,
      createdAt: input.measuredAt,
      updatedAt: input.measuredAt,
    },
    created: true,
  } as const;
}
