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
import {
  getProfessionalProfile,
  upsertProfessionalProfile,
} from "./service";

export const PROFESSIONAL_SETTINGS_PREFERENCE_KEY =
  "professional_settings_v1";

const memorySettings = new Map<number, StoredProfessionalSettings>();

function defaultSettings(): StoredProfessionalSettings {
  return {
    version: 1,
    contactEmail: null,
    contactPhone: null,
    patientFacingBio: null,
    defaultReviewIntervalDays: null,
    remindersEnabled: true,
    defaultReminderLeadDays: 1,
    summaryFrequency: "disabled",
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

async function appendSettingsHistory(
  professionalUserId: number,
  eventType: string
) {
  await professionalContentRepository.appendHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: null,
    eventType,
    entityType: "professional_settings",
    entityId: String(professionalUserId),
  });
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
      remindersEnabled: settings.remindersEnabled,
      defaultReminderLeadDays: settings.defaultReminderLeadDays,
      summaryFrequency: settings.summaryFrequency,
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
  const currentProfile = await getProfessionalProfile(professionalUserId);
  const profile = await upsertProfessionalProfile(professionalUserId, {
    displayName: input.displayName,
    registrationNumber: input.registrationNumber,
    active: currentProfile?.active ?? true,
  });
  const current = await readStoredSettings(professionalUserId);
  const settings = await writeStoredSettings(professionalUserId, {
    ...current,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
    patientFacingBio: input.patientFacingBio ?? null,
    updatedAt: Date.now(),
  });
  await appendSettingsHistory(professionalUserId, "settings_identity_updated");
  return { profile, settings };
}

export async function updateProfessionalPreferencesSettings(
  professionalUserId: number,
  rawInput: ProfessionalPreferencesSettingsInput
) {
  const input = professionalPreferencesSettingsSchema.parse(rawInput);
  const current = await readStoredSettings(professionalUserId);
  const settings = await writeStoredSettings(professionalUserId, {
    ...current,
    defaultReviewIntervalDays: input.defaultReviewIntervalDays,
    remindersEnabled: input.remindersEnabled,
    defaultReminderLeadDays: input.defaultReminderLeadDays,
    summaryFrequency: input.summaryFrequency,
    messageTemplates: input.messageTemplates.map(template => ({
      ...template,
      id: template.id ?? crypto.randomUUID(),
    })),
    updatedAt: Date.now(),
  });
  await appendSettingsHistory(
    professionalUserId,
    "settings_preferences_updated"
  );
  return settings;
}

export async function setProfessionalProfileActive(
  professionalUserId: number,
  active: boolean
) {
  const profile = await getProfessionalProfile(professionalUserId);
  if (!profile) {
    throw new Error(
      "Cadastre a identificação profissional antes de alterar a disponibilidade da área."
    );
  }
  const updated = await upsertProfessionalProfile(professionalUserId, {
    displayName: profile.displayName,
    registrationNumber: profile.registrationNumber,
    active,
  });
  await appendSettingsHistory(
    professionalUserId,
    active ? "settings_profile_activated" : "settings_profile_deactivated"
  );
  return updated;
}

export async function listPatientVisibleProfessionalProfiles(
  patientUserId: number
) {
  const authorizations = await professionalRepository.listAuthorizationsByPatient(
    patientUserId
  );
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
}
