import { trpc } from "@/lib/trpc";
import { DEFAULT_APP_TIME_ZONE } from "@shared/timeZone";

/**
 * Fonte canônica do timezone do usuário autenticado.
 *
 * O fallback local serve apenas para renderização enquanto a consulta está em
 * andamento. Fluxos que consultam ou persistem dados temporais devem aguardar
 * `isReady` antes de executar.
 */
export function useEffectiveUserTimeZone() {
  const query = trpc.nutrition.onboarding.timeZone.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...query,
    timeZone: query.data?.timeZone ?? DEFAULT_APP_TIME_ZONE,
    source: query.data?.source ?? "fallback",
    fallbackReason: query.data?.fallbackReason,
    isReady: query.isSuccess,
  } as const;
}
