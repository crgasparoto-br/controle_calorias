import { listProfessionalOperationalAlerts } from "./operationalAlertsService";
import { getProfessionalStatus } from "./service";

type PriorityAlertDependencies = {
  getStatus: typeof getProfessionalStatus;
  listAlerts: typeof listProfessionalOperationalAlerts;
};

const defaultDependencies: PriorityAlertDependencies = {
  getStatus: getProfessionalStatus,
  listAlerts: listProfessionalOperationalAlerts,
};

export function createProfessionalAiPriorityAlertSource(
  overrides: Partial<PriorityAlertDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function listProfessionalAiPriorityAlerts(
    professionalUserId: number,
    patientUserId?: number,
    range?: { startDate: string; endDate: string }
  ) {
    const status = await dependencies.getStatus(professionalUserId);
    if (!status.hasActiveProfile) {
      throw new Error("A Área Profissional está indisponível para este perfil.");
    }
    return dependencies.listAlerts(professionalUserId, patientUserId, range);
  };
}

export const listProfessionalAiPriorityAlerts =
  createProfessionalAiPriorityAlertSource();
