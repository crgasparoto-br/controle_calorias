import type { ProfessionalAiAssistantOutput } from "./aiSchemas";

const CLINICAL_TOPIC_PATTERN =
  /\b(?:diagnost\w*|prescrev\w*|prescricao|receit\w*|dose|dosagem|medicamento|medicacao|remedio|doenca|transtorno|sindrome|tratamento(?: medico)?|diabet\w*|hipertens\w*|pressao alta|anorex\w*|bulim\w*|anemi\w*|infecc\w*|cancer|neoplas\w*|insuficiencia renal|doenca renal|hipotireoid\w*|hipertireoid\w*|insulin\w*|antidepress\w*|antibiot\w*|comprimid\w*|suplement\w*|desnutr\w*|obes\w*|sobrepes\w*|sintoma\w*|deficiencia\w*|risco clinico|quadro clinico)\b/;

const AUTONOMOUS_ACTION_VERBS =
  "tomar|tome|usar|use|iniciar|inicie|suspender|suspenda|interromper|interrompa|administrar|administre|aplicar|aplique|aumentar|aumente|reduzir|reduza|ajustar|ajuste|definir|defina|limitar|limite|eliminar|elimine|cortar|corte|retirar|retire|evitar|evite|fazer|faca|seguir|siga|adotar|adote|manter|mantenha|consumir|consuma|ingerir|ingira|trocar|troque|substituir|substitua|praticar|pratique|estabelecer|estabeleca|fixar|fixe|deixar|deixe|propor|proponha|aconselhar|aconselhe|restringir|restrinja|incluir|inclua|optar|opte|priorizar|priorize|determinar|determine|estipular|estipule|zerar|zere|comer|coma|montar|monte|distribuir|distribua|favorecer|favoreca|privilegiar|privilegie|concentrar|concentre|equilibrar|equilibre|escolher|escolha";

const DIRECTIVE_CUES =
  "deve|devo|devemos|deveria|deveriamos|precisa|recomendo|recomende|recomendar|oriento|oriente|orientar|sugiro|sugira|sugerir|indico|indique|indicar|aconselho|aconselhe|aconselhar|e necessario|o ideal e|convem";

const IMPERSONAL_DIRECTIVE_CUES =
  "recomenda-se|sugere-se|indica-se|orienta-se|aconselha-se|prescreve-se|deve-se|e recomendado|seria recomendado|e indicado|seria indicado|e aconselhado|seria aconselhado|e ideal|seria ideal";

const NOMINAL_DIRECTIVE_CUES =
  "recomendacao|sugestao|indicacao|orientacao|conduta|prescricao";

const EVALUATIVE_QUALIFIERS =
  "adequad\\w*|recomendad\\w*|indicad\\w*|aconselhad\\w*|apropriad\\w*|preferivel|ideal|bom|boa|melhor|a melhor opcao|melhor opcao|a melhor escolha|melhor escolha";

const MEDICAL_TARGETS =
  "mg|g|ml|comprimid\\w*|medicamento|medicacao|remedio|insulin\\w*|antidepress\\w*|antibiot\\w*|suplement\\w*|tratamento";

const NUTRITION_TARGETS =
  "meta(?: calorica)?|caloria\\w*|kcal|proteina\\w*|carboidrato\\w*|gordura\\w*|macronutriente\\w*|macro\\w*|refeicao|refeicoes|alimento\\w*|dieta\\w*|jejum|plano alimentar|cardapio\\w*|porcao|porcoes|vegetal\\w*|fruta\\w*|legume\\w*|verdura\\w*|salada\\w*|lanche\\w*|cafe da manha|almoco|jantar|consumo|ingestao|acucar|sal|sodio|gluten|lactose|fibra\\w*|agua|liquido\\w*|saciedade";

const BODY_AND_ACTIVITY_TARGETS =
  "peso|kg|quilo\\w*|emagrec\\w*|engord\\w*|perda de peso|ganho de peso|exercicio\\w*|atividade fisica|treino\\w*|corrida|caminhada|musculacao|quilometragem|km|minuto\\w* de atividade";

const ALL_CLINICAL_TARGETS = `${MEDICAL_TARGETS}|${NUTRITION_TARGETS}|${BODY_AND_ACTIVITY_TARGETS}`;
const PRESCRIPTIVE_MARKERS =
  `${AUTONOMOUS_ACTION_VERBS}|${DIRECTIVE_CUES}|${IMPERSONAL_DIRECTIVE_CUES}|${NOMINAL_DIRECTIVE_CUES}|${EVALUATIVE_QUALIFIERS}|recomendad\\w*|orientad\\w*|sugerid\\w*|indicad\\w*|aconselhad\\w*|poderia|podemos|posso|considero|considera-se|apostar|aposte`;

const SENSITIVE_DOMAIN_PATTERN = new RegExp(
  `\\b(?:${ALL_CLINICAL_TARGETS})\\b`
);
const GENERAL_PRESCRIPTIVE_PATTERN = new RegExp(
  `\\b(?:${PRESCRIPTIVE_MARKERS})\\b`
);
const MARKER_THEN_TARGET_PATTERN = new RegExp(
  `\\b(?:${PRESCRIPTIVE_MARKERS})\\b.{0,160}\\b(?:${ALL_CLINICAL_TARGETS})\\b`
);
const TARGET_THEN_MARKER_PATTERN = new RegExp(
  `\\b(?:${ALL_CLINICAL_TARGETS})\\b.{0,160}\\b(?:${PRESCRIPTIVE_MARKERS})\\b`
);

const CLINICAL_ASSERTION_PATTERN =
  /\b(?:o paciente|a paciente|a pessoa acompanhada|voce|ele|ela)\b.{0,100}\b(?:tem|possui|apresenta|esta com|sofre de|demonstra|indica|sugere|tem sinais de|suspeita de|quadro compativel com|trata-se de|e um caso de)\b/;
const UNSUPPORTED_CLINICAL_CONCLUSION_PATTERN =
  /\b(?:trata-se de|e um caso de|quadro(?: clinico)? compativel com|quadro renal|quadro hepatic\w*|quadro cardiac\w*|suspeita de|tem sinais de)\b/;

const EXPLICIT_CLINICAL_PATTERNS = [
  CLINICAL_TOPIC_PATTERN,
  CLINICAL_ASSERTION_PATTERN,
  UNSUPPORTED_CLINICAL_CONCLUSION_PATTERN,
  GENERAL_PRESCRIPTIVE_PATTERN,
  MARKER_THEN_TARGET_PATTERN,
  TARGET_THEN_MARKER_PATTERN,
];

const OBJECTIVE_QUESTION_START_PATTERN =
  /^(?:compare|comparar|mostre|mostrar|liste|listar|resuma|resumir|explique|explicar|quanto|quanta|quantos|quantas|qual foi|quais foram|como foi|como esta|como evoluiu|o que mudou|o que chama atencao|ha diferenca|existe diferenca)\b/;

const COMMON_OBJECTIVE_WORDS = [
  "a", "ao", "aos", "as", "agua", "aderencia", "alimentar", "alimentares",
  "anterior", "anteriores", "atencao", "atividade", "atividades", "atual",
  "atuais", "baixa", "baixo", "caloria", "calorias", "calorica", "caloricas",
  "calculada", "calculadas", "calculado", "calculados", "carboidrato",
  "carboidratos", "com", "como", "consumo", "da", "das", "dados", "de",
  "diferenca", "dia", "dias", "do", "dos", "e", "esta", "estavel", "efetiva",
  "efetivas", "entre", "evolucao", "evoluiu", "exercicio", "exercicios", "final",
  "finais", "fisica", "foi", "foram", "frequencia", "g", "gordura", "gorduras",
  "grama", "gramas", "ha", "ingestao", "kg", "kcal", "macro", "macros",
  "macronutriente", "macronutrientes", "media", "medias", "medio", "medios",
  "meta", "metas", "ml", "mudou", "na", "nas", "neste", "nesta", "nesse",
  "nessa", "no", "nos", "o", "os", "para", "peso", "periodo", "periodos",
  "planejada", "planejadas", "planejado", "planejados", "por", "proteina",
  "proteinas", "qual", "quais", "quanta", "quantas", "quanto", "quantos", "que",
  "realizada", "realizadas", "realizado", "realizados", "registro", "registrada",
  "registradas", "registrado", "registrados", "registros", "semana", "semanas",
  "sinal", "sinais", "total", "totais", "um", "uma", "util", "uteis", "variacao",
  "versus",
];

const OBJECTIVE_QUESTION_ALLOWED_WORDS = new Set([
  ...COMMON_OBJECTIVE_WORDS,
  "compare", "comparar", "explique", "explicar", "liste", "listar", "mostre",
  "mostrar", "resuma", "resumir",
]);

const OBJECTIVE_PROVIDER_ALLOWED_WORDS = new Set([
  ...COMMON_OBJECTIVE_WORDS,
  "acima", "abaixo", "assistida", "assistido", "atingiu", "aumentou", "catalogo",
  "comparacao", "consistente", "diminuiu", "disponivel", "dentro", "educativo",
  "ficaram", "ficou", "fora", "humana", "informa", "indice", "insuficiente",
  "insuficientes", "mostra", "mostram", "objetiva", "objetivas", "objetivo",
  "objetivos", "pendente", "permaneceu", "pesagem", "possui", "possuia", "reduziu",
  "relatorio", "resposta", "resumo", "revisao", "somou", "totalizou", "variou",
]);

const OBJECTIVE_PROVIDER_EVIDENCE_PATTERN =
  /\b(?:registrad\w*|calculad\w*|realizad\w*|planejad\w*|foi|foram|ficou|ficaram|totalizou|somou|atingiu|variou|aumentou|diminuiu|reduziu|permaneceu|informa|mostra|mostram|possui|possuia)\b/;

export type ProfessionalAiQuestionSafety =
  | "provider_allowed"
  | "deterministic_only"
  | "focus_classifier"
  | "clinical_boundary";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function splitClauses(value: string) {
  return normalize(value)
    .split(/(?:[!?;:\n]+|,(?!\d)|\.(?!\d)|\s+-\s+)/)
    .map(clause => clause.trim())
    .filter(Boolean);
}

function hasExplicitClinicalIntent(clause: string) {
  return EXPLICIT_CLINICAL_PATTERNS.some(pattern => pattern.test(clause));
}

function usesOnlyAllowedWords(clause: string, allowedWords: Set<string>) {
  const words = clause.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (
    words.length > 0 &&
    words.every(word => /^\p{N}+$/u.test(word) || allowedWords.has(word))
  );
}

function isStrictObjectiveQuestion(clause: string) {
  return (
    OBJECTIVE_QUESTION_START_PATTERN.test(clause) &&
    usesOnlyAllowedWords(clause, OBJECTIVE_QUESTION_ALLOWED_WORDS)
  );
}

function isStrictProviderClause(clause: string) {
  if (!usesOnlyAllowedWords(clause, OBJECTIVE_PROVIDER_ALLOWED_WORDS)) {
    return false;
  }
  return (
    !SENSITIVE_DOMAIN_PATTERN.test(clause) ||
    OBJECTIVE_PROVIDER_EVIDENCE_PATTERN.test(clause)
  );
}

export function classifyProfessionalAiQuestion(
  question: string | undefined
): ProfessionalAiQuestionSafety {
  if (!question?.trim()) return "provider_allowed";
  let hasSensitiveClause = false;

  for (const clause of splitClauses(question)) {
    if (hasExplicitClinicalIntent(clause)) return "clinical_boundary";
    const sensitiveClause = SENSITIVE_DOMAIN_PATTERN.test(clause);
    if (!isStrictObjectiveQuestion(clause)) {
      if (sensitiveClause) return "clinical_boundary";
      return question.trim().endsWith("?")
        ? "focus_classifier"
        : "clinical_boundary";
    }
    if (sensitiveClause) hasSensitiveClause = true;
  }

  return hasSensitiveClause ? "deterministic_only" : "provider_allowed";
}

export function isClinicalRequest(question: string | undefined) {
  return classifyProfessionalAiQuestion(question) === "clinical_boundary";
}

export function assertProfessionalAiOutputIsSafe(
  output: ProfessionalAiAssistantOutput
) {
  const providerControlledContent = [
    output.title,
    output.summary,
    ...output.interpretations,
    ...output.cautions,
    output.draft?.content ?? "",
  ].join("\n");

  const unsafe = splitClauses(providerControlledContent).some(
    clause => hasExplicitClinicalIntent(clause) || !isStrictProviderClause(clause)
  );
  if (unsafe) {
    throw new Error("professional_ai_prohibited_clinical_output");
  }
}
