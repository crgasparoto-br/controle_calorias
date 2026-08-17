import {
  ANALYTICS_EVENT_NAMES,
  SENSITIVE_ANALYTICS_PROPERTY_KEYS,
  type AnalyticsEventMap,
  type AnalyticsEventName,
  type AnalyticsProperties,
} from "@shared/analytics";

declare global {
  interface Window {
    umami?: {
      track: (name: string, properties?: AnalyticsProperties) => void | Promise<void>;
    };
  }
}

const eventNameSet = new Set<AnalyticsEventName>(ANALYTICS_EVENT_NAMES);
const sensitiveKeySet = new Set<string>(SENSITIVE_ANALYTICS_PROPERTY_KEYS);

function sanitizeProperties(properties: AnalyticsProperties = {}) {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      if (sensitiveKeySet.has(key)) return false;
      if (value === undefined) return false;
      return ["string", "number", "boolean"].includes(typeof value) || value === null;
    }),
  );
}

export function trackEvent<TName extends AnalyticsEventName>(
  name: TName,
  properties: AnalyticsEventMap[TName] = {} as AnalyticsEventMap[TName],
) {
  if (!eventNameSet.has(name) || typeof window === "undefined") return;

  try {
    void window.umami?.track(name, sanitizeProperties(properties as AnalyticsProperties));
  } catch (error) {
    console.warn("[Analytics] Tracking skipped", {
      event: name,
      reason: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

