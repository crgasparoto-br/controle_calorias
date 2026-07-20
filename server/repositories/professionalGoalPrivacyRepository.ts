import { desc, eq, or } from "drizzle-orm";
import {
  professionalGoalNotifications,
  professionalGoalReviewRequests,
  professionalOfficialGoals,
} from "../../drizzle/professional-schema";

type DbProvider = () => Promise<any | null>;

export function createProfessionalGoalPrivacyRepository(deps: {
  getDb: DbProvider;
}) {
  return {
    async listExportData(userId: number) {
      const db = await deps.getDb();
      if (!db)
        return { officialGoals: [], reviewRequests: [], notifications: [] };
      const [goals, reviewRequests, notifications] = await Promise.all([
        db
          .select()
          .from(professionalOfficialGoals)
          .where(
            or(
              eq(professionalOfficialGoals.patientUserId, userId),
              eq(professionalOfficialGoals.professionalUserId, userId)
            )
          )
          .orderBy(desc(professionalOfficialGoals.createdAt)),
        db
          .select()
          .from(professionalGoalReviewRequests)
          .where(
            or(
              eq(professionalGoalReviewRequests.patientUserId, userId),
              eq(professionalGoalReviewRequests.professionalUserId, userId)
            )
          )
          .orderBy(desc(professionalGoalReviewRequests.createdAt)),
        db
          .select()
          .from(professionalGoalNotifications)
          .where(eq(professionalGoalNotifications.patientUserId, userId))
          .orderBy(desc(professionalGoalNotifications.createdAt)),
      ]);
      return {
        officialGoals: goals.map(
          (goal: typeof professionalOfficialGoals.$inferSelect) => ({
            ...goal,
            justification:
              goal.professionalUserId === userId
                ? goal.justification
                : "Justificativa profissional privada não incluída na exportação do paciente.",
          })
        ),
        reviewRequests,
        notifications,
      };
    },
  };
}
