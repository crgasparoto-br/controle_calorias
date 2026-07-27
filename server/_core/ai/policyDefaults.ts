/**
 * Single module owning default timeout/attempt values for the per-capability
 * config resolver. Defaults are chosen to be behaviorally equivalent to the
 * pre-#921 baseline (no explicit timeout/retry policy existed; requests ran
 * once, without an internal timeout wrapper, relying on the HTTP client's own
 * defaults). Capabilities that do not set env overrides fall back to these.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_ATTEMPTS = 1;

export const DEFAULT_FALLBACK_ENABLED = false;
export const DEFAULT_CROSS_PROVIDER_FALLBACK_ENABLED = false;
