import { listProfessionalPriorityAlerts } from "../../repositories/professionalPriorityAlertsRepository";
import type { OperationalAlert } from "./aiContext";
import { evaluateProfessionalOperationalAlerts } from "./operationalAlertsService";
import { getProfessionalStatus } from "./service";

type PriorityAlertDependencies = {
  evaluateAlerts: typeof evaluateProfessionalOperationalAlerts;
  getStatus: typeof getProfessionalStatus;
  listAlerts: (professionalUserId: number) => Promise<OperationalAlert[]>;
};

const defaultDependencies: PriorityAlertDependencies = {
  evaluateAlerts: evaluateProfessionalOperationalAlerts,
  getStatus: getProfessionalStatus,
  listAlerts: listProfessionalPriorityAlerts,
};

export function createProfessionalAiPriorityAlertSource(
  overrides: Partial<PriorityAlertDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function listProfessionalAiPriorityAlerts(
    professionalUserId: number
  ) {
    const status = await dependencies.getStatus(professionalUserId);
    if (!status.hasActiveProfile) {
      throw new Error("A Área Profissional está indisponível para este perfil.");
    }
    await dependencies.evaluateAlerts(professionalUserId);
    return dependencies.listAlerts(professionalUserId);
  };
}

export const listProfessionalAiPriorityAlerts =
  createProfessionalAiPriorityAlertSource();
