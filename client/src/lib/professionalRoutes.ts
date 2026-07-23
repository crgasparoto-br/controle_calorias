import type { ProfessionalRouteEntitlement } from "@/components/ProfessionalEntitlementGate";

export const professionalPatientSections = [
  "assessment",
  "goals",
  "guidance",
  "notes",
  "history",
  "reports",
  "messages",
] as const;

export type ProfessionalPatientSection =
  | "record"
  | (typeof professionalPatientSections)[number];

export type ProfessionalPatientRoute =
  | { kind: "none" }
  | { kind: "invalid"; rawPatientId: string }
  | {
      kind: "patient";
      patientId: number;
      section: ProfessionalPatientSection;
    };

export type ProfessionalPatientRouteEntitlement =
  | "professional_record"
  | "professional_reports"
  | "professional_messages";

function pathnameFromLocation(location: string) {
  const queryIndex = location.indexOf("?");
  const hashIndex = location.indexOf("#");
  const end = [queryIndex, hashIndex]
    .filter(index => index >= 0)
    .reduce((smallest, index) => Math.min(smallest, index), location.length);

  const pathname = location.slice(0, end).replace(/\/+$/, "");
  return pathname || "/";
}

export function parseProfessionalPatientRoute(
  location: string
): ProfessionalPatientRoute {
  const pathname = pathnameFromLocation(location);
  const match = pathname.match(
    /^\/professional\/patients\/([^/]+)(?:\/(assessment|goals|guidance|notes|history|reports|messages))?$/
  );

  if (!match) return { kind: "none" };

  const rawPatientId = match[1];
  if (!/^\d+$/.test(rawPatientId)) {
    return { kind: "invalid", rawPatientId };
  }

  const patientId = Number(rawPatientId);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    return { kind: "invalid", rawPatientId };
  }

  return {
    kind: "patient",
    patientId,
    section: (match[2] as ProfessionalPatientSection | undefined) ?? "record",
  };
}

export function professionalPatientPath(
  patientId: number,
  section: ProfessionalPatientSection = "record"
) {
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new Error("patientId must be a positive safe integer");
  }

  const suffix = section === "record" ? "" : `/${section}`;
  return `/professional/patients/${patientId}${suffix}`;
}

export function professionalPatientResourceForRoute(
  route: ProfessionalPatientRoute
): ProfessionalPatientRouteEntitlement | null {
  if (route.kind !== "patient") return null;
  if (route.section === "reports") return "professional_reports";
  if (route.section === "messages") return "professional_messages";
  return "professional_record";
}

export function professionalResourceForPath(
  location: string
): ProfessionalRouteEntitlement {
  const pathname = pathnameFromLocation(location);

  if (pathname === "/professional/patients") {
    return "professional_portfolio";
  }

  const patientResource = professionalPatientResourceForRoute(
    parseProfessionalPatientRoute(pathname)
  );
  if (patientResource) return patientResource;

  if (pathname.startsWith("/professional/patients/")) {
    return "professional_record";
  }
  if (pathname === "/professional/messages") {
    return "professional_messages";
  }
  if (pathname === "/professional/reports") {
    return "professional_reports";
  }
  if (pathname === "/professional/settings") {
    return "professional_settings";
  }

  return "professional_dashboard";
}
