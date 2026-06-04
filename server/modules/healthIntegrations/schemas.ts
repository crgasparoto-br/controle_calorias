import { z } from "zod";

export const healthProviderSchema = z.enum(["apple_health", "health_connect", "google_fit", "strava", "garmin_connect", "mock"]);
export const healthDataTypeSchema = z.enum(["steps", "weight", "activity", "energy_burned", "sleep"]);

export const connectHealthIntegrationSchema = z.object({
  provider: healthProviderSchema,
  consentAccepted: z.literal(true),
  scopes: z.array(healthDataTypeSchema).min(1),
});

export const syncHealthIntegrationSchema = z.object({
  provider: healthProviderSchema,
});

export const disconnectHealthIntegrationSchema = z.object({
  provider: healthProviderSchema,
});

export type HealthProvider = z.infer<typeof healthProviderSchema>;
export type HealthDataType = z.infer<typeof healthDataTypeSchema>;
export type ConnectHealthIntegrationInput = z.infer<typeof connectHealthIntegrationSchema>;
export type SyncHealthIntegrationInput = z.infer<typeof syncHealthIntegrationSchema>;
export type DisconnectHealthIntegrationInput = z.infer<typeof disconnectHealthIntegrationSchema>;
