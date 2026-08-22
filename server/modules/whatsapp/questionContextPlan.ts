export type QuestionContextScope = "none" | "today" | "week" | "last7Days" | "month" | "period" | "full";

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

function normalizedWords(value: string) {
  return value.replace(/\?+$/g, "").trim().split(/\s+/).filter(Boolean);
}

const PERSONAL_REFERENCE_PATTERN = /\b(?:eu|meu|minha|meus|minhas|mim|comi|consumi|bebi|fiz|estou|tenho|tive|ingeri|registrei)\b/;
const PERSONAL_ADVICE_PATTERN = /\b(?:devo|deveria|preciso|precisaria|posso|poderia|quero|gostaria)\b|\b(?:para|pra) mim\b/;
const FOLLOW_UP_PATTERN = /^(?:e\b|e sobre\b|e quanto\b|e a\b|e o\b|isso\b|essa\b|esse\b|essas\b|esses\b|tambem\b|agora\b)|\b(?:anterior|antes|voce sugeriu|voce falou|que voce disse)\b/;
const REFERENTIAL_PATTERN = /\b(?:isso|isto|aquilo|ele|ela|eles|elas|esse|essa|esses|essas|este|esta|estes|estas|aquele|aquela|aqueles|aquelas)\b/;
const AMBIGUOUS_GENERIC_REFERENCE_PATTERN = /^(?:qual (?:e )?(?:a |o )?(?:melhor|pior)(?: opcao| alternativa)?(?:\?|$)|qual (?:e )?(?:a |o )?(?:recomendad[oa]|recomendacao|quantidade|valor|total|resultado|meta|consumo|peso)(?:\?|$)|quanto(?:s|as)? (?:foi|foram|deu|deram|ficou|ficaram|teve|tinha|houve)(?:\b|$)|como (?:calcular|saber)(?:\?|$)|por que (?:foi|deu|ficou|isso|assim|aconteceu|ocorreu)(?:\b|$)|porque (?:foi|deu|ficou|isso|assim|aconteceu|ocorreu)(?:\b|$)|quando (?:foi|isso|aconteceu)(?:\?|$)|onde (?:encontro|fica|foi|estava)(?:\?|$))/;
const TODAY_PATTERN = /\b(?:hoje|agora|neste dia|no dia de hoje)\b/;
const WEEK_PATTERN = /\b(?:esta semana|nessa semana|semana atual)\b/;
const LAST_7_DAYS_PATTERN = /\b(?:ultimos 7 dias|ultimas 7 dias)\b/;
const MONTH_PATTERN = /\b(?:este mes|nesse mes|mes atual)\b/;
const PERIOD_PATTERN = /\b(?:ultimos 30 dias|ultimas 30 dias|evolucao|tendencia|historico)\b/;

function hasTailAfterPrefix(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  if (!match?.[1]) return false;
  return normalizedWords(match[1]).length > 0;
}

function hasDescriptiveQualTail(value: string) {
  const match = value.match(/^qual (?:(?:e )(?:a |o )?|(?:a |o ))(.+)$/);
  if (!match?.[1]) return false;
  return normalizedWords(match[1]).length >= 3;
}

function hasDescriptiveQuaisTail(value: string) {
  const match = value.match(/^quais (?:(?:sao )(?:as |os )?|(?:as |os ))(.+)$/);
  if (!match?.[1]) return false;
  return normalizedWords(match[1]).length >= 3;
}

function isClearlyGenericQuestion(value: string) {
  // Deictic/reference terms make the question dependent on prior context even
  // when the grammatical prefix would otherwise look self-contained.
  if (REFERENTIAL_PATTERN.test(value)) return false;

  if (hasTailAfterPrefix(value, /^o que (?:e|significa) (.+)$/)) return true;
  if (hasDescriptiveQualTail(value)) return true;
  if (hasDescriptiveQuaisTail(value)) return true;
  if (hasTailAfterPrefix(value, /^quais habitos (.+)$/)) return true;
  if (hasTailAfterPrefix(value, /^quantas calorias (?:tem|ha) (.+)$/)) return true;
  if (hasTailAfterPrefix(value, /^como funciona (.+)$/)) return true;
  if (hasTailAfterPrefix(value, /^como calcular (.+)$/)) return true;
  if (hasTailAfterPrefix(value, /^como saber (.+)$/)) return true;
  if (hasTailAfterPrefix(value, /^para que serve (.+)$/)) return true;
  if (/^diferenca entre .+\be\b.+/.test(value)) return true;
  if (hasTailAfterPrefix(value, /^e verdade que (.+)$/)) return true;
  if (normalizedWords(value.replace(/^por que /, "")).length >= 3 && /^por que /.test(value)) return true;
  if (normalizedWords(value.replace(/^porque /, "")).length >= 3 && /^porque /.test(value)) return true;
  return false;
}

/**
 * Selects the smallest user-data window that is clearly required by the
 * current question. Ambiguous and short follow-up questions deliberately use
 * the full context so latency improvements cannot silently remove information
 * needed for conversational continuity.
 */
export function resolveQuestionContextScope(question: string): QuestionContextScope {
  const normalized = normalizeQuestion(question);
  if (!normalized) return "full";

  if (FOLLOW_UP_PATTERN.test(normalized) || AMBIGUOUS_GENERIC_REFERENCE_PATTERN.test(normalized)) {
    return "full";
  }

  const needsPersonalContext = PERSONAL_REFERENCE_PATTERN.test(normalized) || PERSONAL_ADVICE_PATTERN.test(normalized);
  if (needsPersonalContext && TODAY_PATTERN.test(normalized)) return "today";
  if (needsPersonalContext && LAST_7_DAYS_PATTERN.test(normalized)) return "last7Days";
  if (needsPersonalContext && WEEK_PATTERN.test(normalized)) return "week";
  if (needsPersonalContext && MONTH_PATTERN.test(normalized)) return "month";
  if (needsPersonalContext && PERIOD_PATTERN.test(normalized)) return "period";

  if (!needsPersonalContext && isClearlyGenericQuestion(normalized)) return "none";

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
    case "last7Days":
    case "month":
    case "period":
      return { today: false, currentWeek: false, last30Days: true };
    case "full":
      return { today: true, currentWeek: true, last30Days: true };
  }
}
