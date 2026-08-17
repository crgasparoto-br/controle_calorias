import { getQuestionContextSections, type QuestionContextScope } from "./questionContextPlan";

export type QuestionContextLoaders<TToday, TCurrentWeek, TLast30Days> = {
  loadToday: () => Promise<TToday>;
  loadCurrentWeek: () => Promise<TCurrentWeek>;
  loadLast30Days: () => Promise<TLast30Days>;
};

export type LoadedQuestionContext<TToday, TCurrentWeek, TLast30Days> = {
  today?: TToday;
  currentWeek?: TCurrentWeek;
  last30Days?: TLast30Days;
};

/**
 * Shared context-loading boundary used by the production QUESTION path and the
 * hermetic latency benchmark. Baseline behavior is represented by scope=full;
 * optimized behavior passes the deterministic scope selected for the question.
 */
export async function loadQuestionContextByScope<TToday, TCurrentWeek, TLast30Days>(
  scope: QuestionContextScope,
  loaders: QuestionContextLoaders<TToday, TCurrentWeek, TLast30Days>,
): Promise<LoadedQuestionContext<TToday, TCurrentWeek, TLast30Days>> {
  const sections = getQuestionContextSections(scope);
  const [today, currentWeek, last30Days] = await Promise.all([
    sections.today ? loaders.loadToday() : Promise.resolve(undefined),
    sections.currentWeek ? loaders.loadCurrentWeek() : Promise.resolve(undefined),
    sections.last30Days ? loaders.loadLast30Days() : Promise.resolve(undefined),
  ]);

  return {
    ...(today !== undefined ? { today } : {}),
    ...(currentWeek !== undefined ? { currentWeek } : {}),
    ...(last30Days !== undefined ? { last30Days } : {}),
  };
}
