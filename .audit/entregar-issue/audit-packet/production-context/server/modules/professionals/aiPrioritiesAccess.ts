import { listProfessionalPriorityAlerts as listCompletePriorityAlerts } from "../../repositories/professionalPriorityAlertsRepository";
import type { OperationalAlert } from "./aiContext";
import {
  evaluateProfessionalOperationalAlerts,
  listProfessionalOperationalAlerts,
} from "./operationalAlertsService";
import { getProfessionalStatus } from "./service";

type ContextualAlertDependencies = {
  getStatus: typeof getProfessionalStatus;
  listAlerts: typeof listProfessionalOperationalAlerts;
};

type CompletePriorityDependencies = {
  evaluateAlerts: typeof evaluateProfessionalOperationalAlerts;
  getStatus: typeof getProfessionalStatus;
  listAlerts: (professionalUserId: number) => Promise<OperationalAlert[]>;
};

const contextualDependencies: ContextualAlertDependencies = {
  getStatus: getProfessionalStatus,
  listAlerts: listProfessionalOperationalAlerts,
};

const completePriorityDependencies: CompletePriorityDependencies = {
  evaluateAlerts: evaluateProfessionalOperationalAlerts,
  getStatus: getProfessionalStatus,
  listAlerts: listCompletePriorityAlerts,
};

async function requireActiveProfessionalProfile(
  getStatus: typeof getProfessionalStatus,
  professionalUserId: number
) {
  const status = await getStatus(professionalUserId);
  if (!status.hasActiveProfile) {
    throw new Error("A Área Profissional está indisponível para este perfil.");
  }
}

export function createProfessionalAiPriorityAlertSource(
  overrides: Partial<ContextualAlertDependencies> = {}
) {
  const dependencies = { ...contextualDependencies, ...overrides };

  return async function listProfessionalAiPriorityAlerts(
    professionalUserId: number,
    patientUserId?: number,
    range?: { startDate: string; endDate: string }
  ) {
    await requireActiveProfessionalProfile(
      dependencies.getStatus,
      professionalUserId
    );
    return dependencies.listAlerts(professionalUserId, patientUserId, range);
  };
}

export function createProfessionalPriorityAlertSource(
  overrides: Partial<CompletePriorityDependencies> = {}
) {
  const dependencies = { ...completePriorityDependencies, ...overrides };

  return async function listProfessionalPriorityAlerts(
    professionalUserId: number
  ) {
    await requireActiveProfessionalProfile(
      dependencies.getStatus,
      professionalUserId
    );
    await dependencies.evaluateAlerts(professionalUserId);
    return dependencies.listAlerts(professionalUserId);
  };
}

export const listProfessionalAiPriorityAlerts =
  createProfessionalAiPriorityAlertSource();
export const listProfessionalPriorityAlerts =
  createProfessionalPriorityAlertSource();
