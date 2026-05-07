import {
  ANALYTICS_EVENT_NAMES,
  SENSITIVE_ANALYTICS_PROPERTY_KEYS,
  type AnalyticsEventMap,
  type AnalyticsEventName,
  type AnalyticsProperties,
} from "@shared/analytics";

export type AnalyticsProvider = {
  track(event: {
    name: AnalyticsEventName;
    properties: AnalyticsProperties;
  }): Promise<void> | void;
};

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

export class AnalyticsService {
  constructor(private provider: AnalyticsProvider = { track: () => undefined }) {}

  setProvider(provider: AnalyticsProvider) {
    this.provider = provider;
  }

  async track<TName extends AnalyticsEventName>(
    name: TName,
    properties: AnalyticsEventMap[TName] = {} as AnalyticsEventMap[TName],
  ) {
    if (!eventNameSet.has(name)) return;

    try {
      await this.provider.track({
        name,
        properties: sanitizeProperties(properties as AnalyticsProperties),
      });
    } catch (error) {
      console.warn("[Analytics] Tracking skipped", {
        event: name,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
}

export const analyticsService = new AnalyticsService();

