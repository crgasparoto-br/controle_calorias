export const PROFESSIONAL_ENTITLEMENT_RESOURCES = [
  "professional_dashboard",
  "professional_portfolio",
  "professional_record",
  "professional_goals",
  "professional_operational_alerts",
  "professional_messages",
  "professional_reports",
  "professional_ai_assistance",
  "professional_settings",
] as const;

export type ProfessionalEntitlementResource =
  (typeof PROFESSIONAL_ENTITLEMENT_RESOURCES)[number];
