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

export const listSyncedHealthRecordsSchema = z.object({
  provider: healthProviderSchema.optional(),
  dataType: healthDataTypeSchema.optional(),
  activityType: z.string().trim().min(1).max(80).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type HealthProvider = z.infer<typeof healthProviderSchema>;
export type HealthDataType = z.infer<typeof healthDataTypeSchema>;
export type ConnectHealthIntegrationInput = z.infer<typeof connectHealthIntegrationSchema>;
export type SyncHealthIntegrationInput = z.infer<typeof syncHealthIntegrationSchema>;
export type DisconnectHealthIntegrationInput = z.infer<typeof disconnectHealthIntegrationSchema>;
export type ListSyncedHealthRecordsInput = z.infer<typeof listSyncedHealthRecordsSchema>;
