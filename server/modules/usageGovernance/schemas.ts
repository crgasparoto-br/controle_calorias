import { z } from "zod";
import { authorizeConsumptionChargingSchema as consumptionChargingDraftSchema } from "./schemasCore";

export * from "./schemasCore";

const id = z.string().uuid();
const reason = z.string().trim().min(3).max(255);

const consumptionChargingTransitionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), id, reason }),
  z.object({ action: z.literal("activate"), id, reason, reinforcedConfirmation: z.literal(true) }),
  z.object({ action: z.literal("suspend"), id, reason }),
]);

export const authorizeConsumptionChargingSchema = z.union([
  consumptionChargingDraftSchema,
  consumptionChargingTransitionCommandSchema,
]);
