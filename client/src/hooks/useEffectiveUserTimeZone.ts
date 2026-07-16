import { trpc } from "@/lib/trpc";
import { DEFAULT_APP_TIME_ZONE } from "@shared/timeZone";

/**
 * Fonte canônica do timezone do usuário autenticado.
 *
 * Enquanto a consulta está pendente, fluxos temporais permanecem bloqueados.
 * Depois de uma falha definitiva, a aplicação continua em modo degradado com
 * o fallback local, evitando que toda a navegação fique presa em carregamento.
 */
export function useEffectiveUserTimeZone() {
  const query = trpc.nutrition.onboarding.timeZone.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const hasResolutionError = query.isError;
  const isReady = query.isSuccess || hasResolutionError;
  const isAuthoritative = query.isSuccess;

  return {
    ...query,
    status: isReady ? "success" : query.status,
    isSuccess: isReady,
    isError: false,
    error: null,
    timeZone: query.data?.timeZone ?? DEFAULT_APP_TIME_ZONE,
    source: query.data?.source ?? "fallback",
    fallbackReason: query.data?.fallbackReason,
    isReady,
    isAuthoritative,
    isUsingFallback: !isAuthoritative,
    hasResolutionError,
    resolutionError: hasResolutionError ? query.error : null,
  } as const;
}
