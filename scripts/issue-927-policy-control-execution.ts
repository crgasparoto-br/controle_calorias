import { executeResolvedCapability } from "../server/_core/ai/capabilityExecutor";
import { resolveCapabilityConfig } from "../server/_core/ai/configResolver";
import type { AiInferenceEvent } from "../server/_core/ai/observability";
import {
  ISSUE_927_CONTROL_FAMILIES,
  ISSUE_927_EXTERNAL_CAPABILITIES,
  ISSUE_927_POLICY_PROFILES,
  type Issue927ControlFamily,
  type Issue927ExternalCapability,
  type PolicyResult,
} from "./issue-927-policy-control-contract";
import {
  createControlProviders,
  environmentForControl,
  invokeControlOperation,
} from "./issue-927-policy-control-provider";

async function executeControl(
  capability: Issue927ExternalCapability,
  family: Issue927ControlFamily,
): Promise<PolicyResult> {
  const profile = ISSUE_927_POLICY_PROFILES[capability];
  const { calls, concurrency, providerFactories } = createControlProviders(profile, family);
  const events: AiInferenceEvent[] = [];
  const config = resolveCapabilityConfig(capability, environmentForControl(capability, profile, family));
  let succeeded = false;
  try {
    await executeResolvedCapability(
      config,
      context => invokeControlOperation(profile.operation, context),
      {
        providerFactories,
        observability: { origin: "system", flow: "issue_927_policy_control" },
        observabilitySink: event => events.push(event),
      },
    );
    succeeded = true;
  } catch {
    succeeded = false;
  }

  const fallbackCalls = events.filter(event => event.callRole === "fallback").length;
  const primaryCalls = events.filter(
    event => event.callRole === "primary" || event.callRole === "retry",
  ).length;
  const base = calls.every(
    call => call.provider === profile.primaryProvider || call.provider === profile.fallbackProvider,
  ) && calls.every(
    call => call.model === profile.primaryModel || call.model === profile.fallbackModel,
  ) && concurrency.max <= 1;

  let specific = false;
  if (family === "fallback-disabled") {
    specific = !config.fallback.requested
      && !config.fallback.effectivelyEnabled
      && !succeeded
      && calls.length === 1
      && fallbackCalls === 0;
  } else if (family === "retry") {
    specific = !config.fallback.effectivelyEnabled
      && succeeded
      && calls.length === 2
      && primaryCalls === 2
      && fallbackCalls === 0;
  } else if (family === "same-provider-fallback") {
    specific = config.fallback.effectivelyEnabled
      && succeeded
      && calls.length === 2
      && fallbackCalls === 1
      && calls.every(call => call.provider === profile.primaryProvider);
  } else {
    specific = config.fallback.requested
      && !config.fallback.effectivelyEnabled
      && config.fallback.crossProviderEnabled
      && !succeeded
      && calls.length === 1
      && fallbackCalls === 0
      && calls.every(call => call.provider === profile.primaryProvider);
  }

  return {
    id: `${capability}:${family}`,
    capability,
    family,
    passed: base && specific,
    state: config.state,
    calls: calls.length,
    primaryCalls,
    fallbackCalls,
    maxConcurrency: concurrency.max,
    primaryProvider: profile.primaryProvider,
    primaryModel: profile.primaryModel,
    fallbackProvider: profile.fallbackProvider,
    fallbackModel: profile.fallbackModel,
    fallbackRequested: config.fallback.requested,
    fallbackEffectivelyEnabled: config.fallback.effectivelyEnabled,
    crossProviderEnabled: config.fallback.crossProviderEnabled,
    outcomes: events.map(event => `${event.callRole}:${event.outcome}`),
  };
}

export async function evaluateIssue927PolicyControls(): Promise<PolicyResult[]> {
  const results: PolicyResult[] = [];
  for (const capability of ISSUE_927_EXTERNAL_CAPABILITIES) {
    for (const family of ISSUE_927_CONTROL_FAMILIES) {
      results.push(await executeControl(capability, family));
    }
  }
  return results;
}
