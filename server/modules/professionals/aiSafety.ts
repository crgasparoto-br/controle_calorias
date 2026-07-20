import type { ProfessionalAiAssistantOutput } from "./aiSchemas";

const CLINICAL_TOPIC_PATTERN =
  /\b(?:diagnost\w*|prescrev\w*|prescricao|receit\w*|dose|dosagem|medicamento|medicacao|remedio|doenca|transtorno|sindrome|tratamento(?: medico)?|diabet\w*|hipertens\w*|pressao alta|anorex\w*|bulim\w*|anemi\w*|infecc\w*|cancer|neoplas\w*|insuficiencia renal|doenca renal|hipotireoid\w*|hipertireoid\w*|insulin\w*|antidepress\w*|antibiot\w*|comprimid\w*|suplement\w*)\b/;

const AUTONOMOUS_ACTION_VERBS =
  "tomar|tome|usar|use|iniciar|inicie|suspender|suspenda|interromper|interrompa|administrar|administre|aplicar|aplique|aumentar|aumente|reduzir|reduza|ajustar|ajuste|definir|defina|limitar|limite|eliminar|elimine|cortar|corte|retirar|retire|evitar|evite|fazer|faca|seguir|siga|adotar|adote|manter|mantenha|consumir|consuma|ingerir|ingira|trocar|troque|substituir|substitua|praticar|pratique";

const MEDICAL_TARGETS =
  "mg|g|ml|comprimid\\w*|medicamento|medicacao|remedio|insulin\\w*|antidepress\\w*|antibiot\\w*|suplement\\w*|tratamento";

const NUTRITION_TARGETS =
  "meta(?: calorica)?|caloria\\w*|kcal|proteina\\w*|carboidrato\\w*|gordura\\w*|macronutriente\\w*|macro\\w*|refeicao|refeicoes|alimento\\w*|dieta\\w*|jejum|plano alimentar|consumo|ingestao|acucar|sal|sodio|gluten|lactose|fibra\\w*|agua|liquido\\w*";

const AUTONOMOUS_MEDICAL_ACTION_PATTERN = new RegExp(
  `\\b(?:deve|precisa|recomendo|orientado a|e necessario|o ideal e)?\\s*(?:${AUTONOMOUS_ACTION_VERBS})\\b.{0,120}\\b(?:${MEDICAL_TARGETS})\\b`
);

const AUTONOMOUS_NUTRITION_ACTION_PATTERN = new RegExp(
  `\\b(?:deve|precisa|recomendo|orientado a|e necessario|o ideal e)?\\s*(?:${AUTONOMOUS_ACTION_VERBS})\\b.{0,120}\\b(?:${NUTRITION_TARGETS})\\b`
);

const CLINICAL_ASSERTION_PATTERN =
  /\b(?:o paciente|a paciente|a pessoa acompanhada|voce|ele|ela)\b.{0,80}\b(?:tem|possui|apresenta|esta com|sofre de|demonstra|indica|sugere|tem sinais de|suspeita de|quadro compativel com|trata-se de|e um caso de)\b.{0,80}\b(?:hipertens\w*|pressao alta|doenca\w*|transtorno\w*|sindrome\w*|diabet\w*|anorex\w*|bulim\w*|anemi\w*|infecc\w*|cancer|neoplas\w*|renal\w*|hepatic\w*|cardiac\w*|hipotireoid\w*|hipertireoid\w*)\b/;

const UNSUPPORTED_CLINICAL_CONCLUSION_PATTERN =
  /\b(?:trata-se de|e um caso de|quadro(?: clinico)? compativel com|quadro renal|quadro hepatic\w*|quadro cardiac\w*|suspeita de|tem sinais de)\b/;

const CLINICAL_REQUEST_PATTERNS = [
  CLINICAL_TOPIC_PATTERN,
  AUTONOMOUS_MEDICAL_ACTION_PATTERN,
  AUTONOMOUS_NUTRITION_ACTION_PATTERN,
  UNSUPPORTED_CLINICAL_CONCLUSION_PATTERN,
];

const PROHIBITED_OUTPUT_PATTERNS = [
  CLINICAL_TOPIC_PATTERN,
  CLINICAL_ASSERTION_PATTERN,
  UNSUPPORTED_CLINICAL_CONCLUSION_PATTERN,
  AUTONOMOUS_MEDICAL_ACTION_PATTERN,
  AUTONOMOUS_NUTRITION_ACTION_PATTERN,
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isClinicalRequest(question: string | undefined) {
  if (!question) return false;
  const normalized = normalize(question);
  return CLINICAL_REQUEST_PATTERNS.some(pattern => pattern.test(normalized));
}

export function assertProfessionalAiOutputIsSafe(
  output: ProfessionalAiAssistantOutput
) {
  const content = normalize(
    [
      output.title,
      output.summary,
      ...output.facts,
      ...output.interpretations,
      ...output.missingData,
      ...output.cautions,
      output.draft?.content ?? "",
    ].join("\n")
  );

  if (PROHIBITED_OUTPUT_PATTERNS.some(pattern => pattern.test(content))) {
    throw new Error("professional_ai_prohibited_clinical_output");
  }
}
