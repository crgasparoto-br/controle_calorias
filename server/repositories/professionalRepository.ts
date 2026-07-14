import crypto from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  professionalPatientAuthorizations,
  professionalPatientTrackingEvents,
  professionalPatientTrackings,
  professionalProfiles,
  type ProfessionalPatientAuthorizationRecord,
  type ProfessionalPatientTrackingRecord,
  type ProfessionalProfileRecord,
} from "../../drizzle/professional-schema";
import { userPreferences } from "../../drizzle/schema";
import {
  PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
  PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
  PROFESSIONAL_PROFILE_PREFERENCE_KEY,
  assertProfessionalTrackingTransition,
  canonicalAuthorizationToLegacy,
  getAuthorizationActivePairKey,
  legacyAccessToCanonical,
  parseLegacyProfessionalAccesses,
  parseLegacyProfessionalProfile,
  type CanonicalProfessionalAuthorization,
  type CanonicalProfessionalProfile,
  type CanonicalProfessionalTracking,
  type LegacyProfessionalAccess,
  type ProfessionalAuthorizationStatus,
  type ProfessionalTrackingStatus,
} from "../modules/professionals/persistence";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type UpsertCanonicalProfessionalProfileInput = {
  userId: number;
  displayName: string;
  registrationNumber?: string;
  active: boolean;
  now?: Date;
};

export type UpsertCanonicalProfessionalAuthorizationInput = Omit<
  CanonicalProfessionalAuthorization,
  "activePairKey" | "createdAt" | "updatedAt"
>;

export type TransitionProfessionalAuthorizationInput = {
  authorizationId: string;
  patientUserId: number;
  nextStatus: "approved" | "rejected" | "revoked";
  responseOrigin: "web" | "whatsapp";
  now?: Date;
};

export type TransitionProfessionalTrackingInput = {
  actorUserId: number;
  authorizationId: string;
  nextStatus: ProfessionalTrackingStatus;
  reason?: string;
  now?: Date;
};

export type ProfessionalLegacyMigrationResult = {
  scannedPreferences: number;
  migratedProfiles: number;
  migratedAuthorizations: number;
  invalidPreferences: number;
};

export type ProfessionalRepository = {
  getProfile(userId: number): Promise<CanonicalProfessionalProfile | null>;
  upsertProfile(
    input: UpsertCanonicalProfessionalProfileInput
  ): Promise<CanonicalProfessionalProfile>;
  listAuthorizationsByProfessional(
    professionalUserId: number
  ): Promise<CanonicalProfessionalAuthorization[]>;
  listAuthorizationsByPatient(
    patientUserId: number
  ): Promise<CanonicalProfessionalAuthorization[]>;
  getAuthorizationById(
    authorizationId: string
  ): Promise<CanonicalProfessionalAuthorization | null>;
  getApprovedAuthorization(
    professionalUserId: number,
    patientUserId: number
  ): Promise<CanonicalProfessionalAuthorization | null>;
  upsertAuthorization(
    input: UpsertCanonicalProfessionalAuthorizationInput
  ): Promise<CanonicalProfessionalAuthorization>;
  transitionAuthorization(
    input: TransitionProfessionalAuthorizationInput
  ): Promise<CanonicalProfessionalAuthorization>;
  getTrackingByAuthorization(
    authorizationId: string
  ): Promise<CanonicalProfessionalTracking | null>;
  transitionTracking(
    input: TransitionProfessionalTrackingInput
  ): Promise<CanonicalProfessionalTracking>;
  migrateLegacyUser(userId: number): Promise<ProfessionalLegacyMigrationResult>;
  migrateAllLegacyData(): Promise<ProfessionalLegacyMigrationResult>;
};

function getMysqlAffectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const affectedRows = Number(
    (candidate as { affectedRows?: number })?.affectedRows ?? 0
  );
  return Number.isFinite(affectedRows) ? affectedRows : 0;
}

function toCanonicalProfile(
  row: ProfessionalProfileRecord
): CanonicalProfessionalProfile {
  return {
    ...row,
    registrationNumber: row.registrationNumber ?? undefined,
  };
}

function toCanonicalAuthorization(
  row: ProfessionalPatientAuthorizationRecord
): CanonicalProfessionalAuthorization {
  return row;
}

function toCanonicalTracking(
  row: ProfessionalPatientTrackingRecord
): CanonicalProfessionalTracking {
  return row;
}

function warning(
  deps: { onWarning: PersistenceWarningHandler },
  scope: string,
  code: string
) {
  deps.onWarning(scope, new Error(code));
}

function mergeLegacyAccesses(
  current: LegacyProfessionalAccess[],
  next: LegacyProfessionalAccess
) {
  return [...current.filter(item => item.id !== next.id), next].sort(
    (a, b) => b.requestedAt - a.requestedAt
  );
}

const fallbackProfiles = new Map<number, CanonicalProfessionalProfile>();
const fallbackAuthorizations = new Map<
  string,
  CanonicalProfessionalAuthorization
>();
const fallbackTrackings = new Map<string, CanonicalProfessionalTracking>();

function fallbackProfile(
  input: UpsertCanonicalProfessionalProfileInput
): CanonicalProfessionalProfile {
  const now = input.now ?? new Date();
  const current = fallbackProfiles.get(input.userId);
  const profile: CanonicalProfessionalProfile = {
    userId: input.userId,
    displayName: input.displayName,
    registrationNumber: input.registrationNumber,
    active: input.active,
    sourceUpdatedAt: now,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  fallbackProfiles.set(input.userId, profile);
  return profile;
}

function findFallbackActivePair(
  input: Pick<
    UpsertCanonicalProfessionalAuthorizationInput,
    "professionalUserId" | "patientUserId" | "status"
  >
) {
  const activePairKey = getAuthorizationActivePairKey(input);
  if (!activePairKey) return null;
  return (
    [...fallbackAuthorizations.values()].find(
      item => item.activePairKey === activePairKey
    ) ?? null
  );
}

function fallbackAuthorization(
  input: UpsertCanonicalProfessionalAuthorizationInput
): CanonicalProfessionalAuthorization {
  const current = fallbackAuthorizations.get(input.id);
  const conflictingPair = !current ? findFallbackActivePair(input) : null;
  if (conflictingPair) return conflictingPair;

  const authorization: CanonicalProfessionalAuthorization = {
    ...input,
    activePairKey: getAuthorizationActivePairKey(input),
    createdAt: current?.createdAt ?? input.sourceUpdatedAt,
    updatedAt: input.sourceUpdatedAt,
  };
  fallbackAuthorizations.set(input.id, authorization);
  if (
    authorization.status === "approved" &&
    !fallbackTrackings.has(authorization.id)
  ) {
    const now = authorization.approvedAt ?? authorization.sourceUpdatedAt;
    fallbackTrackings.set(authorization.id, {
      id: authorization.id,
      authorizationId: authorization.id,
      professionalUserId: authorization.professionalUserId,
      patientUserId: authorization.patientUserId,
      status: "active",
      startedAt: now,
      pausedAt: null,
      endedAt: null,
      lastTransitionAt: now,
      lastTransitionByUserId: authorization.patientUserId,
      lastTransitionReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return authorization;
}

function assertAuthorizationTransition(
  current: ProfessionalAuthorizationStatus,
  next: TransitionProfessionalAuthorizationInput["nextStatus"]
) {
  if (current === next) return;
  if (next === "revoked" && (current === "pending" || current === "approved"))
    return;
  if ((next === "approved" || next === "rejected") && current === "pending")
    return;
  throw new Error(
    "A situação da autorização foi alterada. Atualize os dados e tente novamente."
  );
}

function buildTransitionedAuthorization(
  current: CanonicalProfessionalAuthorization,
  input: TransitionProfessionalAuthorizationInput,
  now: Date
): UpsertCanonicalProfessionalAuthorizationInput {
  assertAuthorizationTransition(current.status, input.nextStatus);
  const {
    activePairKey: _activePairKey,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...base
  } = current;
  if (current.status === input.nextStatus) return base;

  return {
    ...base,
    status: input.nextStatus,
    approvedAt:
      input.nextStatus === "approved"
        ? now
        : input.nextStatus === "rejected"
          ? null
          : current.approvedAt,
    rejectedAt:
      input.nextStatus === "rejected"
        ? now
        : input.nextStatus === "approved"
          ? null
          : current.rejectedAt,
    revokedAt: input.nextStatus === "revoked" ? now : null,
    respondedAt: now,
    responseOrigin: input.responseOrigin,
    responseDecision: input.nextStatus,
    sourceUpdatedAt: now,
  };
}

async function readLegacyPreference(
  db: any,
  userId: number,
  preferenceKey: string
) {
  const [row] = await db
    .select()
    .from(userPreferences)
    .where(
      and(
        eq(userPreferences.userId, userId),
        eq(userPreferences.preferenceKey, preferenceKey)
      )
    )
    .limit(1);
  return row ?? null;
}

async function writeLegacyProfile(
  db: any,
  profile: CanonicalProfessionalProfile
) {
  const legacy = {
    userId: profile.userId,
    displayName: profile.displayName,
    registrationNumber: profile.registrationNumber,
    active: profile.active,
    createdAt: profile.createdAt.getTime(),
    updatedAt: profile.sourceUpdatedAt.getTime(),
  };
  await db
    .insert(userPreferences)
    .values({
      userId: profile.userId,
      preferenceKey: PROFESSIONAL_PROFILE_PREFERENCE_KEY,
      preferenceValue: JSON.stringify(legacy),
    })
    .onDuplicateKeyUpdate({
      set: { preferenceValue: JSON.stringify(legacy) },
    });
}

async function writeLegacyAuthorizationSide(
  db: any,
  ownerUserId: number,
  preferenceKey: string,
  authorization: CanonicalProfessionalAuthorization
) {
  const row = await readLegacyPreference(db, ownerUserId, preferenceKey);
  const parsed = row?.preferenceValue
    ? parseLegacyProfessionalAccesses(
        ownerUserId,
        preferenceKey,
        row.preferenceValue
      )
    : { value: [] as LegacyProfessionalAccess[], issue: null };
  const current = parsed.value ?? [];
  const next = mergeLegacyAccesses(
    current,
    canonicalAuthorizationToLegacy(authorization)
  );
  await db
    .insert(userPreferences)
    .values({
      userId: ownerUserId,
      preferenceKey,
      preferenceValue: JSON.stringify(next),
    })
    .onDuplicateKeyUpdate({
      set: { preferenceValue: JSON.stringify(next) },
    });
}

async function writeLegacyAuthorization(
  db: any,
  authorization: CanonicalProfessionalAuthorization
) {
  await db.transaction(async (tx: any) => {
    await writeLegacyAuthorizationSide(
      tx,
      authorization.professionalUserId,
      PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
      authorization
    );
    await writeLegacyAuthorizationSide(
      tx,
      authorization.patientUserId,
      PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
      authorization
    );
  });
}

export function createDrizzleProfessionalRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): ProfessionalRepository {
  async function insertTrackingForApprovedAuthorization(
    tx: any,
    authorization: CanonicalProfessionalAuthorization,
    actorUserId: number
  ) {
    if (authorization.status !== "approved") return;
    const [existing] = await tx
      .select()
      .from(professionalPatientTrackings)
      .where(eq(professionalPatientTrackings.authorizationId, authorization.id))
      .limit(1);
    if (existing) return;

    const now = authorization.approvedAt ?? authorization.sourceUpdatedAt;
    await tx.insert(professionalPatientTrackings).values({
      id: authorization.id,
      authorizationId: authorization.id,
      professionalUserId: authorization.professionalUserId,
      patientUserId: authorization.patientUserId,
      status: "active",
      startedAt: now,
      pausedAt: null,
      endedAt: null,
      lastTransitionAt: now,
      lastTransitionByUserId: actorUserId,
      lastTransitionReason: null,
    });
    await tx.insert(professionalPatientTrackingEvents).values({
      id: crypto.randomUUID(),
      trackingId: authorization.id,
      authorizationId: authorization.id,
      actorUserId,
      fromStatus: null,
      toStatus: "active",
      reason: null,
      occurredAt: now,
    });
  }

  async function persistAuthorizationCanonical(
    db: any,
    input: UpsertCanonicalProfessionalAuthorizationInput,
    options: { preserveNewerSource: boolean; actorUserId?: number }
  ) {
    const values = {
      ...input,
      activePairKey: getAuthorizationActivePairKey(input),
    };
    const [currentById] = await db
      .select()
      .from(professionalPatientAuthorizations)
      .where(eq(professionalPatientAuthorizations.id, input.id))
      .limit(1);
    if (
      options.preserveNewerSource &&
      currentById &&
      new Date(currentById.sourceUpdatedAt).getTime() >=
        input.sourceUpdatedAt.getTime()
    ) {
      return toCanonicalAuthorization(currentById);
    }

    try {
      await db.transaction(async (tx: any) => {
        await tx
          .insert(professionalPatientAuthorizations)
          .values({
            ...values,
            createdAt: currentById?.createdAt ?? input.requestedAt,
          })
          .onDuplicateKeyUpdate({
            set: values,
          });
        const [saved] = await tx
          .select()
          .from(professionalPatientAuthorizations)
          .where(eq(professionalPatientAuthorizations.id, input.id))
          .limit(1);
        if (!saved)
          throw new Error(
            "Não foi possível persistir a autorização profissional."
          );
        await insertTrackingForApprovedAuthorization(
          tx,
          toCanonicalAuthorization(saved),
          options.actorUserId ?? saved.patientUserId
        );
      });
    } catch (error) {
      if (values.activePairKey) {
        const [existingPair] = await db
          .select()
          .from(professionalPatientAuthorizations)
          .where(
            eq(
              professionalPatientAuthorizations.activePairKey,
              values.activePairKey
            )
          )
          .limit(1);
        if (existingPair) return toCanonicalAuthorization(existingPair);
      }
      throw error;
    }

    const [saved] = await db
      .select()
      .from(professionalPatientAuthorizations)
      .where(eq(professionalPatientAuthorizations.id, input.id))
      .limit(1);
    if (!saved)
      throw new Error("Não foi possível persistir a autorização profissional.");
    return toCanonicalAuthorization(saved);
  }

  async function upsertLegacyProfileRow(row: any) {
    if (!row?.preferenceValue) return { migrated: 0, invalid: 0 };
    const sourceUpdatedAt = new Date(
      row.updatedAt ?? row.createdAt ?? Date.now()
    );
    const parsed = parseLegacyProfessionalProfile(
      row.userId,
      row.preferenceValue,
      sourceUpdatedAt
    );
    if (!parsed.value) {
      warning(
        deps,
        "professional.persistence.legacy_profile_skipped",
        parsed.issue ?? "invalid_shape"
      );
      return { migrated: 0, invalid: 1 };
    }

    const db = await deps.getDb();
    if (!db) {
      const current = fallbackProfiles.get(row.userId);
      if (
        !current ||
        current.sourceUpdatedAt.getTime() < sourceUpdatedAt.getTime()
      ) {
        fallbackProfiles.set(row.userId, parsed.value);
        return { migrated: 1, invalid: parsed.issue ? 1 : 0 };
      }
      return { migrated: 0, invalid: parsed.issue ? 1 : 0 };
    }

    const [current] = await db
      .select()
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, row.userId))
      .limit(1);
    if (
      current &&
      new Date(current.sourceUpdatedAt).getTime() >= sourceUpdatedAt.getTime()
    ) {
      return { migrated: 0, invalid: parsed.issue ? 1 : 0 };
    }

    await db
      .insert(professionalProfiles)
      .values({
        userId: parsed.value.userId,
        displayName: parsed.value.displayName,
        registrationNumber: parsed.value.registrationNumber,
        active: parsed.value.active,
        sourceUpdatedAt,
        createdAt: parsed.value.createdAt,
        updatedAt: parsed.value.updatedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          displayName: parsed.value.displayName,
          registrationNumber: parsed.value.registrationNumber,
          active: parsed.value.active,
          sourceUpdatedAt,
          updatedAt: parsed.value.updatedAt,
        },
      });
    return { migrated: 1, invalid: parsed.issue ? 1 : 0 };
  }

  async function upsertLegacyAuthorization(
    access: LegacyProfessionalAccess,
    sourceUpdatedAt: Date
  ) {
    const canonical = legacyAccessToCanonical(access, sourceUpdatedAt);
    const db = await deps.getDb();
    if (!db) {
      const current = fallbackAuthorizations.get(access.id);
      if (
        !current ||
        current.sourceUpdatedAt.getTime() < sourceUpdatedAt.getTime()
      ) {
        fallbackAuthorization(canonical);
        return 1;
      }
      return 0;
    }

    try {
      const saved = await persistAuthorizationCanonical(db, canonical, {
        preserveNewerSource: true,
      });
      if (saved.id !== canonical.id) {
        warning(
          deps,
          "professional.persistence.legacy_authorization_conflict",
          "active_pair_conflict"
        );
        return 0;
      }
      return saved.sourceUpdatedAt.getTime() === sourceUpdatedAt.getTime()
        ? 1
        : 0;
    } catch {
      warning(
        deps,
        "professional.persistence.legacy_authorization_failed",
        "canonical_write_failed"
      );
      return 0;
    }
  }

  async function migratePreferenceRow(row: any) {
    if (row.preferenceKey === PROFESSIONAL_PROFILE_PREFERENCE_KEY) {
      const result = await upsertLegacyProfileRow(row);
      return {
        profiles: result.migrated,
        authorizations: 0,
        invalid: result.invalid,
      };
    }

    const parsed = parseLegacyProfessionalAccesses(
      row.userId,
      row.preferenceKey,
      row.preferenceValue
    );
    if (!parsed.value) {
      warning(
        deps,
        "professional.persistence.legacy_authorizations_skipped",
        parsed.issue ?? "invalid_shape"
      );
      return { profiles: 0, authorizations: 0, invalid: 1 };
    }
    const sourceUpdatedAt = new Date(
      row.updatedAt ?? row.createdAt ?? Date.now()
    );
    let migrated = 0;
    for (const access of parsed.value)
      migrated += await upsertLegacyAuthorization(access, sourceUpdatedAt);
    if (parsed.issue) {
      warning(
        deps,
        "professional.persistence.legacy_authorizations_partially_skipped",
        parsed.issue
      );
    }
    return {
      profiles: 0,
      authorizations: migrated,
      invalid: parsed.issue ? 1 : 0,
    };
  }

  async function migrateRows(
    rows: any[]
  ): Promise<ProfessionalLegacyMigrationResult> {
    const result: ProfessionalLegacyMigrationResult = {
      scannedPreferences: rows.length,
      migratedProfiles: 0,
      migratedAuthorizations: 0,
      invalidPreferences: 0,
    };
    for (const row of rows) {
      const migrated = await migratePreferenceRow(row);
      result.migratedProfiles += migrated.profiles;
      result.migratedAuthorizations += migrated.authorizations;
      result.invalidPreferences += migrated.invalid;
    }
    return result;
  }

  async function migrateLegacyUser(userId: number) {
    const db = await deps.getDb();
    if (!db) {
      return {
        scannedPreferences: 0,
        migratedProfiles: 0,
        migratedAuthorizations: 0,
        invalidPreferences: 0,
      };
    }
    const rows = await db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, userId),
          inArray(userPreferences.preferenceKey, [
            PROFESSIONAL_PROFILE_PREFERENCE_KEY,
            PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
            PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
          ])
        )
      );
    return migrateRows(rows);
  }

  async function migrateRelatedAuthorizations(
    userId: number,
    role: "professional" | "patient"
  ) {
    const db = await deps.getDb();
    if (!db) return;
    const oppositeKey =
      role === "professional"
        ? PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY
        : PROFESSIONAL_ACCESSES_PREFERENCE_KEY;
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.preferenceKey, oppositeKey));
    for (const row of rows) {
      const parsed = parseLegacyProfessionalAccesses(
        row.userId,
        row.preferenceKey,
        row.preferenceValue
      );
      if (!parsed.value) continue;
      const sourceUpdatedAt = new Date(
        row.updatedAt ?? row.createdAt ?? Date.now()
      );
      const related = parsed.value.filter(access =>
        role === "professional"
          ? access.professionalUserId === userId
          : access.patientUserId === userId
      );
      for (const access of related)
        await upsertLegacyAuthorization(access, sourceUpdatedAt);
    }
  }

  async function getProfile(userId: number) {
    const db = await deps.getDb();
    if (!db) return fallbackProfiles.get(userId) ?? null;
    await migrateLegacyUser(userId);
    const [row] = await db
      .select()
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, userId))
      .limit(1);
    return row ? toCanonicalProfile(row) : null;
  }

  async function upsertProfile(input: UpsertCanonicalProfessionalProfileInput) {
    const db = await deps.getDb();
    if (!db) return fallbackProfile(input);
    const now = input.now ?? new Date();
    await db
      .insert(professionalProfiles)
      .values({
        userId: input.userId,
        displayName: input.displayName,
        registrationNumber: input.registrationNumber,
        active: input.active,
        sourceUpdatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          displayName: input.displayName,
          registrationNumber: input.registrationNumber,
          active: input.active,
          sourceUpdatedAt: now,
          updatedAt: now,
        },
      });
    const [row] = await db
      .select()
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, input.userId))
      .limit(1);
    if (!row)
      throw new Error("Não foi possível persistir o perfil profissional.");
    const profile = toCanonicalProfile(row);
    try {
      await writeLegacyProfile(db, profile);
    } catch {
      warning(
        deps,
        "professional.persistence.legacy_profile_dual_write_failed",
        "legacy_write_failed"
      );
    }
    return profile;
  }

  async function listAuthorizationsByProfessional(professionalUserId: number) {
    const db = await deps.getDb();
    if (!db) {
      return [...fallbackAuthorizations.values()].filter(
        item => item.professionalUserId === professionalUserId
      );
    }
    await migrateLegacyUser(professionalUserId);
    await migrateRelatedAuthorizations(professionalUserId, "professional");
    const rows = await db
      .select()
      .from(professionalPatientAuthorizations)
      .where(
        eq(
          professionalPatientAuthorizations.professionalUserId,
          professionalUserId
        )
      );
    return rows.map(toCanonicalAuthorization);
  }

  async function listAuthorizationsByPatient(patientUserId: number) {
    const db = await deps.getDb();
    if (!db) {
      return [...fallbackAuthorizations.values()].filter(
        item => item.patientUserId === patientUserId
      );
    }
    await migrateLegacyUser(patientUserId);
    await migrateRelatedAuthorizations(patientUserId, "patient");
    const rows = await db
      .select()
      .from(professionalPatientAuthorizations)
      .where(
        eq(professionalPatientAuthorizations.patientUserId, patientUserId)
      );
    return rows.map(toCanonicalAuthorization);
  }

  async function getAuthorizationById(authorizationId: string) {
    const db = await deps.getDb();
    if (!db) return fallbackAuthorizations.get(authorizationId) ?? null;
    const [row] = await db
      .select()
      .from(professionalPatientAuthorizations)
      .where(eq(professionalPatientAuthorizations.id, authorizationId))
      .limit(1);
    return row ? toCanonicalAuthorization(row) : null;
  }

  async function getApprovedAuthorization(
    professionalUserId: number,
    patientUserId: number
  ) {
    const db = await deps.getDb();
    if (!db) {
      return (
        [...fallbackAuthorizations.values()].find(
          item =>
            item.professionalUserId === professionalUserId &&
            item.patientUserId === patientUserId &&
            item.status === "approved" &&
            item.activePairKey !== null
        ) ?? null
      );
    }
    await Promise.all([
      migrateLegacyUser(professionalUserId),
      migrateLegacyUser(patientUserId),
      migrateRelatedAuthorizations(professionalUserId, "professional"),
      migrateRelatedAuthorizations(patientUserId, "patient"),
    ]);
    const [row] = await db
      .select()
      .from(professionalPatientAuthorizations)
      .where(
        and(
          eq(
            professionalPatientAuthorizations.professionalUserId,
            professionalUserId
          ),
          eq(professionalPatientAuthorizations.patientUserId, patientUserId),
          eq(professionalPatientAuthorizations.status, "approved")
        )
      )
      .limit(1);
    return row ? toCanonicalAuthorization(row) : null;
  }

  async function upsertAuthorization(
    input: UpsertCanonicalProfessionalAuthorizationInput
  ) {
    const db = await deps.getDb();
    if (!db) return fallbackAuthorization(input);
    const authorization = await persistAuthorizationCanonical(db, input, {
      preserveNewerSource: false,
      actorUserId: input.patientUserId,
    });
    try {
      await writeLegacyAuthorization(db, authorization);
    } catch {
      warning(
        deps,
        "professional.persistence.legacy_authorization_dual_write_failed",
        "legacy_write_failed"
      );
    }
    return authorization;
  }

  async function transitionAuthorization(
    input: TransitionProfessionalAuthorizationInput
  ) {
    const now = input.now ?? new Date();
    const db = await deps.getDb();
    if (!db) {
      const current = fallbackAuthorizations.get(input.authorizationId);
      if (!current || current.patientUserId !== input.patientUserId) {
        throw new Error("Solicitação de acesso não encontrada.");
      }
      const next = buildTransitionedAuthorization(current, input, now);
      return fallbackAuthorization(next);
    }

    const patientAuthorizations: CanonicalProfessionalAuthorization[] =
      await listAuthorizationsByPatient(input.patientUserId);
    const current = patientAuthorizations.find(
      item => item.id === input.authorizationId
    );
    if (!current) throw new Error("Solicitação de acesso não encontrada.");
    if (current.status === input.nextStatus) return current;
    const next = buildTransitionedAuthorization(current, input, now);
    const values = {
      ...next,
      activePairKey: getAuthorizationActivePairKey(next),
    };

    await db.transaction(async (tx: any) => {
      const updateResult = await tx
        .update(professionalPatientAuthorizations)
        .set(values)
        .where(
          and(
            eq(professionalPatientAuthorizations.id, current.id),
            eq(
              professionalPatientAuthorizations.patientUserId,
              input.patientUserId
            ),
            eq(professionalPatientAuthorizations.status, current.status)
          )
        );
      if (getMysqlAffectedRows(updateResult) === 0) {
        throw new Error(
          "A situação da autorização foi alterada. Atualize os dados e tente novamente."
        );
      }
      await insertTrackingForApprovedAuthorization(
        tx,
        {
          ...current,
          ...values,
          updatedAt: now,
        },
        input.patientUserId
      );
    });

    const [updated] = await db
      .select()
      .from(professionalPatientAuthorizations)
      .where(eq(professionalPatientAuthorizations.id, current.id))
      .limit(1);
    if (!updated)
      throw new Error("Não foi possível carregar a autorização atualizada.");
    const authorization = toCanonicalAuthorization(updated);
    try {
      await writeLegacyAuthorization(db, authorization);
    } catch {
      warning(
        deps,
        "professional.persistence.legacy_authorization_dual_write_failed",
        "legacy_write_failed"
      );
    }
    return authorization;
  }

  async function getTrackingByAuthorization(authorizationId: string) {
    const db = await deps.getDb();
    if (!db) return fallbackTrackings.get(authorizationId) ?? null;
    const [row] = await db
      .select()
      .from(professionalPatientTrackings)
      .where(eq(professionalPatientTrackings.authorizationId, authorizationId))
      .limit(1);
    return row ? toCanonicalTracking(row) : null;
  }

  async function transitionTracking(
    input: TransitionProfessionalTrackingInput
  ) {
    const db = await deps.getDb();
    const now = input.now ?? new Date();
    if (!db) {
      const authorization = fallbackAuthorizations.get(input.authorizationId);
      if (
        !authorization ||
        authorization.professionalUserId !== input.actorUserId
      ) {
        throw new Error("Acompanhamento profissional não encontrado.");
      }
      if (authorization.status !== "approved") {
        throw new Error("A autorização de dados não está ativa.");
      }
      const current = fallbackTrackings.get(input.authorizationId);
      if (!current)
        throw new Error("Acompanhamento profissional não encontrado.");
      assertProfessionalTrackingTransition(current.status, input.nextStatus);
      if (current.status === input.nextStatus) return current;
      const next = {
        ...current,
        status: input.nextStatus,
        pausedAt: input.nextStatus === "paused" ? now : current.pausedAt,
        endedAt: input.nextStatus === "ended" ? now : null,
        lastTransitionAt: now,
        lastTransitionByUserId: input.actorUserId,
        lastTransitionReason: input.reason?.trim() || null,
        updatedAt: now,
      };
      fallbackTrackings.set(input.authorizationId, next);
      return next;
    }

    const authorization = await getAuthorizationById(input.authorizationId);
    if (
      !authorization ||
      authorization.professionalUserId !== input.actorUserId
    ) {
      throw new Error("Acompanhamento profissional não encontrado.");
    }
    if (authorization.status !== "approved") {
      throw new Error("A autorização de dados não está ativa.");
    }
    const current = await getTrackingByAuthorization(input.authorizationId);
    if (!current)
      throw new Error("Acompanhamento profissional não encontrado.");
    assertProfessionalTrackingTransition(current.status, input.nextStatus);
    if (current.status === input.nextStatus) return current;

    const reason = input.reason?.trim() || null;
    await db.transaction(async (tx: any) => {
      const updateResult = await tx
        .update(professionalPatientTrackings)
        .set({
          status: input.nextStatus,
          pausedAt: input.nextStatus === "paused" ? now : current.pausedAt,
          endedAt: input.nextStatus === "ended" ? now : null,
          lastTransitionAt: now,
          lastTransitionByUserId: input.actorUserId,
          lastTransitionReason: reason,
          updatedAt: now,
        })
        .where(
          and(
            eq(professionalPatientTrackings.id, current.id),
            eq(professionalPatientTrackings.status, current.status)
          )
        );
      if (getMysqlAffectedRows(updateResult) === 0) {
        throw new Error(
          "O acompanhamento foi alterado por outra operação. Atualize os dados e tente novamente."
        );
      }
      await tx.insert(professionalPatientTrackingEvents).values({
        id: crypto.randomUUID(),
        trackingId: current.id,
        authorizationId: input.authorizationId,
        actorUserId: input.actorUserId,
        fromStatus: current.status,
        toStatus: input.nextStatus,
        reason,
        occurredAt: now,
      });
    });

    const [updated] = await db
      .select()
      .from(professionalPatientTrackings)
      .where(eq(professionalPatientTrackings.id, current.id))
      .limit(1);
    if (!updated)
      throw new Error("Não foi possível carregar o acompanhamento atualizado.");
    return toCanonicalTracking(updated);
  }

  async function migrateAllLegacyData() {
    const db = await deps.getDb();
    if (!db) {
      return {
        scannedPreferences: 0,
        migratedProfiles: 0,
        migratedAuthorizations: 0,
        invalidPreferences: 0,
      };
    }
    const rows = await db
      .select()
      .from(userPreferences)
      .where(
        or(
          eq(
            userPreferences.preferenceKey,
            PROFESSIONAL_PROFILE_PREFERENCE_KEY
          ),
          eq(
            userPreferences.preferenceKey,
            PROFESSIONAL_ACCESSES_PREFERENCE_KEY
          ),
          eq(
            userPreferences.preferenceKey,
            PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY
          )
        )
      );
    return migrateRows(rows);
  }

  return {
    getProfile,
    upsertProfile,
    listAuthorizationsByProfessional,
    listAuthorizationsByPatient,
    getAuthorizationById,
    getApprovedAuthorization,
    upsertAuthorization,
    transitionAuthorization,
    getTrackingByAuthorization,
    transitionTracking,
    migrateLegacyUser,
    migrateAllLegacyData,
  };
}
