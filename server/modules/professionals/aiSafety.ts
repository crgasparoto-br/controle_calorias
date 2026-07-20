import type { ProfessionalAiAssistantOutput } from "./aiSchemas";

const CLINICAL_TOPIC_PATTERN =
  /\b(?:diagnost\w*|prescrev\w*|prescricao|receit\w*|dose|dosagem|medicamento|medicacao|remedio|doenca|transtorno|sindrome|tratamento(?: medico)?|diabet\w*|hipertens\w*|pressao alta|anorex\w*|bulim\w*|anemi\w*|infecc\w*|cancer|neoplas\w*|insuficiencia renal|doenca renal|hipotireoid\w*|hipertireoid\w*|insulin\w*|antidepress\w*|antibiot\w*|comprimid\w*|suplement\w*)\b/;

const AUTONOMOUS_ACTION_VERBS =
  "tomar|tome|usar|use|iniciar|inicie|suspender|suspenda|interromper|interrompa|administrar|administre|aplicar|aplique|aumentar|aumente|reduzir|reduza|ajustar|ajuste|definir|defina|limitar|limite|eliminar|elimine|cortar|corte|retirar|retire|evitar|evite|fazer|faca|seguir|siga|adotar|adote|manter|mantenha|consumir|consuma|ingerir|ingira|trocar|troque|substituir|substitua|praticar|pratique|estabelecer|estabeleca|fixar|fixe|deixar|deixe|propor|proponha|aconselhar|aconselhe|restringir|restrinja|incluir|inclua|optar|opte|priorizar|priorize|determinar|determine|estipular|estipule|zerar|zere";

const DIRECTIVE_CUES =
  "deve|precisa|recomendo|recomende|recomendar|oriento|oriente|orientar|sugiro|sugira|sugerir|indico|indique|indicar|aconselho|aconselhe|aconselhar|e necessario|o ideal e|convem";

const IMPERSONAL_DIRECTIVE_CUES =
  "recomenda-se|sugere-se|indica-se|orienta-se|aconselha-se|prescreve-se|deve-se|e recomendado|seria recomendado|e indicado|seria indicado|e aconselhado|seria aconselhado|e ideal|seria ideal";

const NOMINAL_DIRECTIVE_CUES =
  "recomendacao|sugestao|indicacao|orientacao|conduta|prescricao";

const EVALUATIVE_COPULAS = "e|seria|parece|pode ser|deveria ser";
const EVALUATIVE_QUALIFIERS =
  "adequad\\w*|recomendad\\w*|indicad\\w*|aconselhad\\w*|apropriad\\w*|preferivel|ideal|a melhor opcao|melhor opcao|a melhor escolha|melhor escolha";

const MEDICAL_TARGETS =
  "mg|g|ml|comprimid\\w*|medicamento|medicacao|remedio|insulin\\w*|antidepress\\w*|antibiot\\w*|suplement\\w*|tratamento";

const NUTRITION_TARGETS =
  "meta(?: calorica)?|caloria\\w*|kcal|proteina\\w*|carboidrato\\w*|gordura\\w*|macronutriente\\w*|macro\\w*|refeicao|refeicoes|alimento\\w*|dieta\\w*|jejum|plano alimentar|consumo|ingestao|acucar|sal|sodio|gluten|lactose|fibra\\w*|agua|liquido\\w*";

const ALL_CLINICAL_TARGETS = `${MEDICAL_TARGETS}|${NUTRITION_TARGETS}`;
const PRESCRIPTIVE_MARKERS =
  `${AUTONOMOUS_ACTION_VERBS}|${DIRECTIVE_CUES}|${IMPERSONAL_DIRECTIVE_CUES}|${NOMINAL_DIRECTIVE_CUES}|${EVALUATIVE_QUALIFIERS}|recomendad\\w*|orientad\\w*|sugerid\\w*|indicad\\w*|aconselhad\\w*|deveria|poderia|considero|considera-se`;

const SENSITIVE_TARGET_PATTERN = new RegExp(
  `\\b(?:${ALL_CLINICAL_TARGETS})\\b`
);

const AUTONOMOUS_MEDICAL_ACTION_PATTERN = new RegExp(
  `\\b(?:${DIRECTIVE_CUES})?\\s*(?:${AUTONOMOUS_ACTION_VERBS})\\b.{0,120}\\b(?:${MEDICAL_TARGETS})\\b`
);

const AUTONOMOUS_NUTRITION_ACTION_PATTERN = new RegExp(
  `\\b(?:${DIRECTIVE_CUES})?\\s*(?:${AUTONOMOUS_ACTION_VERBS})\\b.{0,120}\\b(?:${NUTRITION_TARGETS})\\b`
);

const DIRECTIVE_TARGET_PATTERN = new RegExp(
  `\\b(?:${DIRECTIVE_CUES})\\b.{0,120}\\b(?:${ALL_CLINICAL_TARGETS})\\b`
);

const IMPERSONAL_DIRECTIVE_PATTERN = new RegExp(
  `\\b(?:${IMPERSONAL_DIRECTIVE_CUES})\\b.{0,120}\\b(?:${ALL_CLINICAL_TARGETS})\\b`
);

const NOMINAL_DIRECTIVE_PATTERN = new RegExp(
  `\\b(?:${NOMINAL_DIRECTIVE_CUES})\\b\\s*(?::|-|de|para)\\s*.{0,120}\\b(?:${ALL_CLINICAL_TARGETS})\\b`
);

const TARGET_FIRST_DIRECTIVE_PATTERN = new RegExp(
  `\\b(?:${ALL_CLINICAL_TARGETS})\\b.{0,80}\\b(?:deve|precisa|recomendad\\w*|indicad\\w*|orientad\\w*|aconselhad\\w*|ideal)\\b`
);

const TARGET_EVALUATION_PATTERN = new RegExp(
  `\\b(?:${ALL_CLINICAL_TARGETS})\\b.{0,80}\\b(?:${EVALUATIVE_COPULAS})\\s+(?:${EVALUATIVE_QUALIFIERS})\\b`
);

const EVALUATION_TARGET_PATTERN = new RegExp(
  `\\b(?:${EVALUATIVE_COPULAS})\\s+(?:${EVALUATIVE_QUALIFIERS})\\b.{0,80}\\b(?:${ALL_CLINICAL_TARGETS})\\b`
);

const PRESCRIPTIVE_MARKER_THEN_TARGET_PATTERN = new RegExp(
  `\\b(?:${PRESCRIPTIVE_MARKERS})\\b.{0,120}\\b(?:${ALL_CLINICAL_TARGETS})\\b`
);

const TARGET_THEN_PRESCRIPTIVE_MARKER_PATTERN = new RegExp(
  `\\b(?:${ALL_CLINICAL_TARGETS})\\b.{0,120}\\b(?:${PRESCRIPTIVE_MARKERS})\\b`
);

const CLINICAL_ASSERTION_PATTERN =
  /\b(?:o paciente|a paciente|a pessoa acompanhada|voce|ele|ela)\b.{0,80}\b(?:tem|possui|apresenta|esta com|sofre de|demonstra|indica|sugere|tem sinais de|suspeita de|quadro compativel com|trata-se de|e um caso de)\b.{0,80}\b(?:hipertens\w*|pressao alta|doenca\w*|transtorno\w*|sindrome\w*|diabet\w*|anorex\w*|bulim\w*|anemi\w*|infecc\w*|cancer|neoplas\w*|renal\w*|hepatic\w*|cardiac\w*|hipotireoid\w*|hipertireoid\w*)\b/;

const UNSUPPORTED_CLINICAL_CONCLUSION_PATTERN =
  /\b(?:trata-se de|e um caso de|quadro(?: clinico)? compativel com|quadro renal|quadro hepatic\w*|quadro cardiac\w*|suspeita de|tem sinais de)\b/;

const OBJECTIVE_EVIDENCE_PATTERNS = [
  /\b(?:registrad\w*|calculad\w*|observad\w*|informad\w*|medid\w*|consumid\w*|consumiu|ingerid\w*|ingeriu|realizad\w*|planejad\w*|mencionad\w*|relatad\w*)\b/,
  /\b(?:foi|foram|ficou|ficaram|totalizou|somou|atingiu|variou|aumentou|diminuiu|reduziu|permaneceu)\b/,
  /\b(?:compare|comparar|comparacao|quant\w*|qual foi|como foi|como esta|como evoluiu|o que mudou|o que chama atencao|mostre|liste|resuma|resumir|ha diferenca|existe diferenca)\b/,
  /\b(?:abaixo|acima|dentro)\s+(?:da|do)\s+(?:meta|faixa)\b/,
  /\b(?:estavel|tendencia|variacao)\b/,
];

const CLINICAL_REQUEST_PATTERNS = [
  CLINICAL_TOPIC_PATTERN,
  AUTONOMOUS_MEDICAL_ACTION_PATTERN,
  AUTONOMOUS_NUTRITION_ACTION_PATTERN,
  DIRECTIVE_TARGET_PATTERN,
  IMPERSONAL_DIRECTIVE_PATTERN,
  NOMINAL_DIRECTIVE_PATTERN,
  TARGET_FIRST_DIRECTIVE_PATTERN,
  TARGET_EVALUATION_PATTERN,
  EVALUATION_TARGET_PATTERN,
  PRESCRIPTIVE_MARKER_THEN_TARGET_PATTERN,
  TARGET_THEN_PRESCRIPTIVE_MARKER_PATTERN,
  UNSUPPORTED_CLINICAL_CONCLUSION_PATTERN,
];

const PROHIBITED_OUTPUT_PATTERNS = [
  CLINICAL_TOPIC_PATTERN,
  CLINICAL_ASSERTION_PATTERN,
  UNSUPPORTED_CLINICAL_CONCLUSION_PATTERN,
  AUTONOMOUS_MEDICAL_ACTION_PATTERN,
  AUTONOMOUS_NUTRITION_ACTION_PATTERN,
  DIRECTIVE_TARGET_PATTERN,
  IMPERSONAL_DIRECTIVE_PATTERN,
  NOMINAL_DIRECTIVE_PATTERN,
  TARGET_FIRST_DIRECTIVE_PATTERN,
  TARGET_EVALUATION_PATTERN,
  EVALUATION_TARGET_PATTERN,
  PRESCRIPTIVE_MARKER_THEN_TARGET_PATTERN,
  TARGET_THEN_PRESCRIPTIVE_MARKER_PATTERN,
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function containsUnsafeClinicalIntent(value: string, patterns: RegExp[]) {
  return normalize(value)
    .split(/(?:[!?;\n]+|\.(?!\d))/)
    .map(clause => clause.trim())
    .filter(Boolean)
    .some(clause => {
      if (patterns.some(pattern => pattern.test(clause))) return true;
      if (!SENSITIVE_TARGET_PATTERN.test(clause)) return false;
      return !OBJECTIVE_EVIDENCE_PATTERNS.some(pattern => pattern.test(clause));
    });
}

export function isClinicalRequest(question: string | undefined) {
  if (!question) return false;
  return containsUnsafeClinicalIntent(question, CLINICAL_REQUEST_PATTERNS);
}

export function assertProfessionalAiOutputIsSafe(
  output: ProfessionalAiAssistantOutput
) {
  const content = [
    output.title,
    output.summary,
    ...output.facts,
    ...output.interpretations,
    ...output.missingData,
    ...output.cautions,
    output.draft?.content ?? "",
  ].join("\n");

  if (containsUnsafeClinicalIntent(content, PROHIBITED_OUTPUT_PATTERNS)) {
    throw new Error("professional_ai_prohibited_clinical_output");
  }
}
