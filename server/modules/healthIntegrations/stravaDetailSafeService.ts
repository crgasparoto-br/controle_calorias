import { healthIntegrationService as baseHealthIntegrationService } from "./service";

const STRAVA_ACTIVITIES_PER_PAGE = 100;
const STRAVA_MAX_ACTIVITY_PAGES = 20;
const STRAVA_ALL_ACTIVITY_DETAIL_REQUESTS_PER_SYNC = String(STRAVA_ACTIVITIES_PER_PAGE * STRAVA_MAX_ACTIVITY_PAGES);
const STRAVA_ACTIVITY_DETAIL_URL_PATTERN = /^https:\/\/www\.strava\.com\/api\/v3\/activities\/\d+$/;

function getRequestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isStravaActivityDetailRequest(input: Parameters<typeof fetch>[0]) {
  return STRAVA_ACTIVITY_DETAIL_URL_PATTERN.test(getRequestUrl(input));
}

async function withStravaActivityDetailGuards<T>(operation: () => Promise<T>) {
  const configuredLimit = process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC;
  const shouldFetchAllDetails = configuredLimit?.trim().toLowerCase() === "all";
  const originalFetch = globalThis.fetch;

  if (shouldFetchAllDetails) {
    process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC = STRAVA_ALL_ACTIVITY_DETAIL_REQUESTS_PER_SYNC;
  }

  globalThis.fetch = (async (input, init) => {
    const response = await originalFetch(input, init);
    if (isStravaActivityDetailRequest(input) && !response.ok && response.status !== 429) {
      throw new Error(`Falha ao buscar detalhe da atividade do Strava (${response.status}).`);
    }

    return response;
  }) as typeof fetch;

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
    if (shouldFetchAllDetails) {
      if (configuredLimit === undefined) {
        delete process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC;
      } else {
        process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC = configuredLimit;
      }
    }
  }
}

export const healthIntegrationService: typeof baseHealthIntegrationService = {
  getStatus(...args) {
    return baseHealthIntegrationService.getStatus(...args);
  },
  connect(...args) {
    return baseHealthIntegrationService.connect(...args);
  },
  disconnect(...args) {
    return baseHealthIntegrationService.disconnect(...args);
  },
  handleStravaCallback(input) {
    return withStravaActivityDetailGuards(() => baseHealthIntegrationService.handleStravaCallback(input));
  },
  sync(userId, input) {
    if (input.provider !== "strava") {
      return baseHealthIntegrationService.sync(userId, input);
    }

    return withStravaActivityDetailGuards(() => baseHealthIntegrationService.sync(userId, input));
  },
  syncConnectedStravaUsers() {
    return withStravaActivityDetailGuards(() => baseHealthIntegrationService.syncConnectedStravaUsers());
  },
};