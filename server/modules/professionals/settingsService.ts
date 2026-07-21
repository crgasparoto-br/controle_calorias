import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { userPreferences } from "../../../drizzle/schema";
import { getDb, logPersistenceWarning } from "../../db";
import { professionalContentRepository } from "./contentPersistenceService";
import { getProfessionalEntitlements } from "./entitlementService";
import { PROFESSIONAL_OPERATIONAL_ALERT_CRITERIA } from "./operationalAlertRules";
import { professionalRepository } from "./persistenceService";
import {
  professionalIdentitySettingsSchema,
  professionalPreferencesSettingsSchema,
  storedProfessionalSettingsSchema,
  type ProfessionalIdentitySettingsInput,
  type ProfessionalPreferencesSettingsInput,
  type StoredProfessionalSettings,
} from "./settingsSchemas";
import { getProfessionalProfile } from "./service";

export const PROFESSIONAL_SETTINGS_PREFERENCE_KEY =
  "professional_settings_v1";

const memorySettings = new Map<number, StoredProfessionalSettings>();
const settingsMutationQueues = new Map<number, Promise<unknown>>();

export class ProfessionalSettingsConsistencyError extends Error {
  constructor() {
    super(
      "Não foi possível confirmar a consistência da alteração profissional. Recarregue a página antes de tentar novamente."
    );
    this.name = "ProfessionalSettingsConsistencyError";
  }
}

function defaultSettings(): StoredProfessionalSettings {
  return {
    version: 1,
    contactEmail: null,
    contactPhone: null,
    patientFacingBio: null,
    defaultReviewIntervalDays: null,
    messageTemplates: [],
    updatedAt: Date.now(),
  };
}

function parseSettings(value: string | null | undefined) {
  if (!value) return null;
  try {
    return storedProfessionalSettingsSchema.parse(JSON.parse(value));
  } catch (error) {
    logPersistenceWarning("professional_settings_parse", error);
    return null;
  }
}

async function readStoredSettings(professionalUserId: number) {
  const db = await getDb();
  if (!db) return memorySettings.get(professionalUserId) ?? defaultSettings();

  try {
    const rows = await db
      .select({ preferenceValue: userPreferences.preferenceValue })
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, professionalUserId),
          eq(
            userPreferences.preferenceKey,
            PROFESSIONAL_SETTINGS_PREFERENCE_KEY
          )
        )
      )
      .limit(1);
    return parseSettings(rows[0]?.preferenceValue) ?? defaultSettings();
  } catch (error) {
    logPersistenceWarning("professional_settings_read", error);
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "As configurações profissionais estão temporariamente indisponíveis."
      );
    }
    return memorySettings.get(professionalUserId) ?? defaultSettings();
  }
}

async function writeStoredSettings(
  professionalUserId: number,
  settings: StoredProfessionalSettings
) {
  const parsed = storedProfessionalSettingsSchema.parse(settings);
  const db = await getDb();
  if (!db) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Não foi possível salvar as configurações profissionais."
      );
    }
    memorySettings.set(professionalUserId, parsed);
    return parsed;
  }

  const now = new Date(parsed.updatedAt);
  await db
    .insert(userPreferences)
    .values({
      userId: professionalUserId,
      preferenceKey: PROFESSIONAL_SETTINGS_PREFERENCE_KEY,
      preferenceValue: JSON.stringify(parsed),
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        preferenceValue: JSON.stringify(parsed),
        updatedAt: now,
      },
    });
  memorySettings.set(professionalUserId, parsed);
  return parsed;
}

function settingsAuditEventId(
  professionalUserId: number,
  eventType: string,
  mutationId: string
) {
  const digest = crypto
    .createHash("sha256")
    .update(`${professionalUserId}:${eventType}:${mutationId}`)
    .digest("hex")
    .slice(0, 48);
  return `settings-${digest}`;
}

async function appendSettingsHistory(
  professionalUserId: number,
  eventType: string,
  mutationId: string
) {
  await professionalContentRepository.appendHistory({
    id: settingsAuditEventId(professionalUserId, eventType, mutationId),
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: null,
    eventType,
    entityType: "professional_settings",
    entityId: String(professionalUserId),
  });
}

async function runSettingsCompensations(
  scope: string,
  compensations: Promise<unknown>[]
) {
  const results = await Promise.allSettled(compensations);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failures.length === 0) return;

  logPersistenceWarning(
    scope,
    new Error(
      `Falharam ${failures.length} de ${compensations.length} compensações de configurações profissionais.`
    )
  );
  throw new ProfessionalSettingsConsistencyError();
}

function serializeSettingsMutation<T>(
  professionalUserId: number,
  operation: () => Promise<T>
) {
  const previous =
    settingsMutationQueues.get(professionalUserId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  settingsMutationQueues.set(professionalUserId, current);
  return current.finally(() => {
    if (settingsMutationQueues.get(professionalUserId) === current) {
      settingsMutationQueues.delete(professionalUserId);
    }
  });
}

async function persistProfessionalProfile(input: {
  userId: number;
  displayName: string;
  registrationNumber?: string;
  active: boolean;
}) {
  const profile = await professionalRepository.upsertProfile({
    ...input,
    now: new Date(),
  });
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    registrationNumber: profile.registrationNumber,
    active: profile.active,
    createdAt: profile.createdAt.getTime(),
    updatedAt: profile.updatedAt.getTime(),
  };
}

export async function getProfessionalOperationalDefaults(
  professionalUserId: number
) {
  const settings = await readStoredSettings(professionalUserId);
  return {
    defaultReviewIntervalDays: settings.defaultReviewIntervalDays,
  };
}

export async function getProfessionalSettingsSnapshot(
  professionalUserId: number
) {
  const [profile, settings, entitlements] = await Promise.all([
    getProfessionalProfile(professionalUserId),
    readStoredSettings(professionalUserId),
    getProfessionalEntitlements(professionalUserId),
  ]);

  return {
    profile,
    identity: {
      contactEmail: settings.contactEmail,
      contactPhone: settings.contactPhone,
      patientFacingBio: settings.patientFacingBio,
    },
    preferences: {
      defaultReviewIntervalDays: settings.defaultReviewIntervalDays,
      messageTemplates: settings.messageTemplates,
    },
    operationalAlertCriteria: PROFESSIONAL_OPERATIONAL_ALERT_CRITERIA,
    entitlements,
    updatedAt: settings.updatedAt,
  };
}

export async function updateProfessionalIdentitySettings(
  professionalUserId: number,
  rawInput: ProfessionalIdentitySettingsInput
) {
  const input = professionalIdentitySettingsSchema.parse(rawInput);
  return serializeSettingsMutation(professionalUserId, async () => {
    const mutationId = crypto.randomUUID();
    const [currentProfile, currentSettings] = await Promise.all([
      getProfessionalProfile(professionalUserId),
      readStoredSettings(professionalUserId),
    ]);
    let updatedProfile: Awaited<
      ReturnType<typeof persistProfessionalProfile>
    > | null = null;

    try {
      updatedProfile = await persistProfessionalProfile({
        userId: professionalUserId,
        displayName: input.displayName,
        registrationNumber: input.registrationNumber,
        active: currentProfile?.active ?? true,
      });
      const settings = await writeStoredSettings(professionalUserId, {
        ...currentSettings,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        patientFacingBio: input.patientFacingBio ?? null,
        updatedAt: Date.now(),
      });
      await appendSettingsHistory(
        professionalUserId,
        "settings_identity_updated",
        mutationId
      );
      return { profile: updatedProfile, settings };
    } catch (error) {
      const compensations: Promise<unknown>[] = [
        writeStoredSettings(professionalUserId, currentSettings),
      ];
      if (currentProfile) {
        compensations.push(
          persistProfessionalProfile({
            userId: professionalUserId,
            displayName: currentProfile.displayName,
            registrationNumber: currentProfile.registrationNumber,
            active: currentProfile.active,
          })
        );
      } else if (updatedProfile) {
        compensations.push(
          persistProfessionalProfile({
            userId: professionalUserId,
            displayName: updatedProfile.displayName,
            registrationNumber: updatedProfile.registrationNumber,
            active: false,
          })
        );
      }
      await runSettingsCompensations(
        "professional_settings_identity_compensation",
        compensations
      );
      throw error;
    }
  });
}

export async function updateProfessionalPreferencesSettings(
  professionalUserId: number,
  rawInput: ProfessionalPreferencesSettingsInput
) {
  const input = professionalPreferencesSettingsSchema.parse(rawInput);
  return serializeSettingsMutation(professionalUserId, async () => {
    const mutationId = crypto.randomUUID();
    const current = await readStoredSettings(professionalUserId);
    const next = storedProfessionalSettingsSchema.parse({
      ...current,
      defaultReviewIntervalDays: input.defaultReviewIntervalDays,
      messageTemplates: input.messageTemplates.map(template => ({
        ...template,
        id: template.id ?? crypto.randomUUID(),
      })),
      updatedAt: Date.now(),
    });

    await writeStoredSettings(professionalUserId, next);
    try {
      await appendSettingsHistory(
        professionalUserId,
        "settings_preferences_updated",
        mutationId
      );
      return next;
    } catch (error) {
      await runSettingsCompensations(
        "professional_settings_preferences_compensation",
        [writeStoredSettings(professionalUserId, current)]
      );
      throw error;
    }
  });
}

export async function setProfessionalProfileActive(
  professionalUserId: number,
  active: boolean
) {
  return serializeSettingsMutation(professionalUserId, async () => {
    const mutationId = crypto.randomUUID();
    const profile = await getProfessionalProfile(professionalUserId);
    if (!profile) {
      throw new Error(
        "Cadastre a identificação profissional antes de alterar a disponibilidade da área."
      );
    }

    const updated = await persistProfessionalProfile({
      userId: professionalUserId,
      displayName: profile.displayName,
      registrationNumber: profile.registrationNumber,
      active,
    });
    try {
      await appendSettingsHistory(
        professionalUserId,
        active ? "settings_profile_activated" : "settings_profile_deactivated",
        mutationId
      );
      return updated;
    } catch (error) {
      await runSettingsCompensations(
        "professional_settings_profile_compensation",
        [
          persistProfessionalProfile({
            userId: professionalUserId,
            displayName: profile.displayName,
            registrationNumber: profile.registrationNumber,
            active: profile.active,
          }),
        ]
      );
      throw error;
    }
  });
}

export async function listPatientVisibleProfessionalProfiles(
  patientUserId: number
) {
  const authorizations =
    await professionalRepository.listAuthorizationsByPatient(patientUserId);
  const approved = authorizations.filter(item => item.status === "approved");
  const uniqueProfessionalIds = Array.from(
    new Set(approved.map(item => item.professionalUserId))
  );
  const visibleProfiles = await Promise.all(
    uniqueProfessionalIds.map(async professionalUserId => {
      const [profile, settings] = await Promise.all([
        getProfessionalProfile(professionalUserId),
        readStoredSettings(professionalUserId),
      ]);
      if (!profile?.active) return null;
      return {
        professionalUserId,
        displayName: profile.displayName,
        registrationNumber: profile.registrationNumber ?? null,
        contactEmail: settings.contactEmail,
        contactPhone: settings.contactPhone,
        patientFacingBio: settings.patientFacingBio,
      };
    })
  );
  return visibleProfiles.filter(
    (profile): profile is NonNullable<typeof profile> => Boolean(profile)
  );
}

export function _forTestOnly_clearProfessionalSettings() {
  memorySettings.clear();
  settingsMutationQueues.clear();
}
