import { listProfessionalPriorityAlerts } from "./aiPrioritiesAccess";
import {
  professionalAlertLabel,
  type OperationalAlert,
} from "./aiContext";

const SEVERITY_WEIGHT: Record<string, number> = {
  urgent: 3,
  attention: 2,
  info: 1,
};

type PriorityDependencies = {
  listAlerts: typeof listProfessionalPriorityAlerts;
};

const defaultDependencies: PriorityDependencies = {
  listAlerts: listProfessionalPriorityAlerts,
};

function severityWeight(value: string | null | undefined) {
  return SEVERITY_WEIGHT[value ?? ""] ?? 0;
}

function relevantAt(alert: OperationalAlert) {
  return (
    alert.period?.end ??
    alert.period?.start ??
    alert.updatedAt ??
    alert.createdAt ??
    Number.MAX_SAFE_INTEGER
  );
}

function stableAlertId(alert: OperationalAlert) {
  return String(alert.id ?? `${alert.type}:${alert.patientUserId}`);
}

function compareAlerts(first: OperationalAlert, second: OperationalAlert) {
  return (
    severityWeight(second.severity) - severityWeight(first.severity) ||
    relevantAt(first) - relevantAt(second) ||
    Number(second.updatedAt ?? 0) - Number(first.updatedAt ?? 0) ||
    stableAlertId(first).localeCompare(stableAlertId(second))
  );
}

function prioritySignal(alert: OperationalAlert) {
  return {
    id: alert.id,
    type: alert.type,
    label: professionalAlertLabel(alert.type),
    severity: alert.severity,
    reason: alert.reason,
    suggestedAction: alert.suggestedAction,
    period: {
      start: alert.period?.start ?? null,
      end: alert.period?.end ?? null,
    },
    updatedAt: alert.updatedAt,
  };
}

function orderedProfessionalPriorities(alerts: OperationalAlert[]) {
  const grouped = new Map<
    number,
    {
      patientId: number;
      displayName: string;
      alerts: OperationalAlert[];
    }
  >();

  for (const alert of alerts) {
    const current = grouped.get(alert.patientUserId) ?? {
      patientId: alert.patientUserId,
      displayName: alert.patientName,
      alerts: [],
    };
    current.alerts.push(alert);
    grouped.set(alert.patientUserId, current);
  }

  return Array.from(grouped.values())
    .map(item => {
      const orderedAlerts = [...item.alerts].sort(compareAlerts);
      const primaryAlert = orderedAlerts[0];
      const signals = orderedAlerts.map(prioritySignal);
      return {
        patientId: item.patientId,
        displayName: item.displayName,
        score:
          severityWeight(primaryAlert?.severity) * 1_000 +
          Math.min(orderedAlerts.length, 20),
        alertCount: orderedAlerts.length,
        highestSeverity: primaryAlert?.severity ?? "info",
        primarySignal: primaryAlert ? prioritySignal(primaryAlert) : null,
        signals,
        updatedAt: Math.max(
          0,
          ...orderedAlerts.map(alert => Number(alert.updatedAt ?? 0))
        ),
      };
    })
    .sort((first, second) => {
      const firstPrimary = first.primarySignal;
      const secondPrimary = second.primarySignal;
      const firstDate =
        firstPrimary?.period.end ??
        firstPrimary?.period.start ??
        firstPrimary?.updatedAt ??
        Number.MAX_SAFE_INTEGER;
      const secondDate =
        secondPrimary?.period.end ??
        secondPrimary?.period.start ??
        secondPrimary?.updatedAt ??
        Number.MAX_SAFE_INTEGER;
      return (
        severityWeight(second.highestSeverity) -
          severityWeight(first.highestSeverity) ||
        firstDate - secondDate ||
        Number(second.updatedAt ?? 0) - Number(first.updatedAt ?? 0) ||
        first.patientId - second.patientId
      );
    });
}

export function buildProfessionalPriorities(
  alerts: OperationalAlert[],
  limit: number,
  offset = 0
) {
  const safeOffset = Math.max(0, offset);
  return orderedProfessionalPriorities(alerts).slice(
    safeOffset,
    safeOffset + limit
  );
}

export function createProfessionalPriorityService(
  overrides: Partial<PriorityDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    async priorities(
      professionalUserId: number,
      limit: number,
      offset = 0
    ) {
      const alerts = await dependencies.listAlerts(professionalUserId);
      return buildProfessionalPriorities(alerts, limit, offset);
    },
  };
}

export const professionalPriorityService = createProfessionalPriorityService();
