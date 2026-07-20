import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../../_core/trpc";
import { getProfessionalEntitlements } from "./entitlementService";
import {
  professionalActiveSettingsSchema,
  professionalIdentitySettingsSchema,
  professionalPreferencesSettingsSchema,
} from "./settingsSchemas";
import {
  getProfessionalSettingsSnapshot,
  listPatientVisibleProfessionalProfiles,
  setProfessionalProfileActive,
  updateProfessionalIdentitySettings,
  updateProfessionalPreferencesSettings,
} from "./settingsService";

function safeSettingsError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      error instanceof Error
        ? error.message
        : "Não foi possível atualizar as configurações profissionais.",
  });
}

export const professionalSettingsRouter = router({
  get: protectedProcedure.query(({ ctx }) =>
    getProfessionalSettingsSnapshot(ctx.user.id)
  ),
  entitlements: protectedProcedure.query(({ ctx }) =>
    getProfessionalEntitlements(ctx.user.id)
  ),
  updateIdentity: protectedProcedure
    .input(professionalIdentitySettingsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateProfessionalIdentitySettings(ctx.user.id, input);
      } catch (error) {
        return safeSettingsError(error);
      }
    }),
  updatePreferences: protectedProcedure
    .input(professionalPreferencesSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateProfessionalPreferencesSettings(ctx.user.id, input);
      } catch (error) {
        return safeSettingsError(error);
      }
    }),
  setActive: protectedProcedure
    .input(professionalActiveSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await setProfessionalProfileActive(ctx.user.id, input.active);
      } catch (error) {
        return safeSettingsError(error);
      }
    }),
  patientVisible: protectedProcedure.query(({ ctx }) =>
    listPatientVisibleProfessionalProfiles(ctx.user.id)
  ),
});
