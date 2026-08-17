import { AsyncLocalStorage } from "node:async_hooks";
import {
  resolveUserTimeZoneValue,
  type UserTimeZoneValueResolution,
} from "../../../shared/timeZone";
import { resolveEffectiveUserTimeZone } from "../timeZone/service";

type WhatsAppTimeZoneRequestContext = {
  resolutions: Map<number, Promise<UserTimeZoneValueResolution>>;
};

const requestContext = new AsyncLocalStorage<WhatsAppTimeZoneRequestContext>();

export function runWithWhatsAppTimeZoneRequestScope<T>(operation: () => T): T {
  return requestContext.run({ resolutions: new Map() }, operation);
}

export async function resolveWhatsAppOperationTimeZone(
  userId: number,
): Promise<UserTimeZoneValueResolution> {
  const context = requestContext.getStore();
  if (!context) {
    return resolveEffectiveUserTimeZone(userId);
  }

  let resolution = context.resolutions.get(userId);
  if (!resolution) {
    resolution = resolveEffectiveUserTimeZone(userId);
    context.resolutions.set(userId, resolution);
  }
  return resolution;
}

export async function getWhatsAppOperationTimeZone(userId: number) {
  return (await resolveWhatsAppOperationTimeZone(userId)).timeZone;
}

/**
 * Mantém a injeção de timezone em simuladores/replays, mas usa exatamente a
 * mesma validação IANA e o mesmo fallback do contrato central compartilhado.
 */
export function resolveInjectedWhatsAppTimeZone(
  value: string | null | undefined,
): UserTimeZoneValueResolution {
  return resolveUserTimeZoneValue(value, { profileExists: value != null });
}
