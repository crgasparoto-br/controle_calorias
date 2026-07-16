import { trpc } from "@/lib/trpc";
import { DEFAULT_APP_TIME_ZONE } from "@shared/timeZone";

/**
 * Fonte canônica do timezone do usuário autenticado.
 *
 * Enquanto a consulta está pendente, fluxos temporais permanecem bloqueados.
 * Depois de uma falha definitiva, a aplicação pode continuar em modo degradado
 * com o fallback local para não prender toda a navegação em carregamento.
 */
export function useEffectiveUserTimeZone() {
  const query = trpc.nutrition.onboarding.timeZone.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const isAuthoritative = query.isSuccess;
  const isReady = query.isSuccess || query.isError;

  return {
    ...query,
    timeZone: query.data?.timeZone ?? DEFAULT_APP_TIME_ZONE,
    source: query.data?.source ?? "fallback",
    fallbackReason: query.data?.fallbackReason,
    isReady,
    isAuthoritative,
    isUsingFallback: !isAuthoritative,
    resolutionError: query.isError ? query.error : null,
  } as const;
}
