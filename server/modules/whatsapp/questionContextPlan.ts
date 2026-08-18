export type QuestionContextScope = "none" | "today" | "week" | "period" | "full";

export type QuestionContextSections = {
  today: boolean;
  currentWeek: boolean;
  last30Days: boolean;
};

function normalizeQuestion(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PERSONAL_CONTEXT_PATTERN = /\b(?:eu|meu|minha|meus|minhas|mim|comi|consumi|bebi|fiz|estou|tenho|tive|peso|meta|metas|consumo|consumido|consumida|ingeri|registrei|registros?|refeic(?:ao|oes)|agua|exercicios?|evolucao|historico|habitos?)\b/;
const PERSONAL_ADVICE_PATTERN = /\b(?:devo|deveria|preciso|precisaria|posso|poderia|quero|gostaria)\b|\b(?:para|pra) mim\b/;
const FOLLOW_UP_PATTERN = /^(?:e\b|e sobre\b|e quanto\b|e a\b|e o\b|isso\b|essa\b|esse\b|essas\b|esses\b|tambem\b|agora\b)|\b(?:anterior|antes|voce sugeriu|voce falou|que voce disse)\b/;
const TODAY_PATTERN = /\b(?:hoje|agora|neste dia|no dia de hoje)\b/;
const WEEK_PATTERN = /\b(?:esta semana|nessa semana|na semana|semana atual|ultimos 7 dias|ultimas 7 dias|7 dias)\b/;
const PERIOD_PATTERN = /\b(?:este mes|nesse mes|no mes|mes atual|ultimos 30 dias|ultimas 30 dias|30 dias|evolucao|tendencia|historico)\b/;
const CLEAR_GENERIC_PATTERN = /^(?:o que (?:e|significa)|qual (?:e|a|o)|quais (?:sao|as|os)|quanto(?:s|as)? |quantas calorias (?:tem|ha)|como funciona|como calcular|como saber|para que serve|diferenca entre|e verdade que|por que |porque |quando |onde )/;

/**
 * Selects the smallest user-data window that is clearly required by the
 * current question. Ambiguous and short follow-up questions deliberately use
 * the full context so latency improvements cannot silently remove information
 * needed for conversational continuity.
 */
export function resolveQuestionContextScope(question: string): QuestionContextScope {
  const normalized = normalizeQuestion(question);
  if (!normalized) return "full";

  if (FOLLOW_UP_PATTERN.test(normalized)) return "full";

  const needsPersonalContext = PERSONAL_CONTEXT_PATTERN.test(normalized) || PERSONAL_ADVICE_PATTERN.test(normalized);
  if (needsPersonalContext && TODAY_PATTERN.test(normalized)) return "today";
  if (needsPersonalContext && WEEK_PATTERN.test(normalized)) return "week";
  if (needsPersonalContext && PERIOD_PATTERN.test(normalized)) return "period";

  if (!needsPersonalContext && CLEAR_GENERIC_PATTERN.test(normalized)) return "none";

  return "full";
}

export function getQuestionContextSections(scope: QuestionContextScope): QuestionContextSections {
  switch (scope) {
    case "none":
      return { today: false, currentWeek: false, last30Days: false };
    case "today":
      return { today: true, currentWeek: false, last30Days: false };
    case "week":
      return { today: false, currentWeek: true, last30Days: false };
    case "period":
      return { today: false, currentWeek: false, last30Days: true };
    case "full":
      return { today: true, currentWeek: true, last30Days: true };
  }
}
