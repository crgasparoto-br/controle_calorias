import type { ProfessionalAiAssistantOutput } from "./aiSchemas";

const CLINICAL_REQUEST_PATTERN =
  /\b(diagnost|prescrev|prescricao|receit|dose|dosagem|medicamento|remedio|doenca|transtorno|tratamento medico|diabet|anorex|bulim|insulin|antidepress|antibiot|comprimid|suplement)\w*/;

const PROHIBITED_OUTPUT_PATTERNS = [
  /\bdiagnost\w*\b/,
  /\bprescrev\w*\b/,
  /\bprescricao\b/,
  /\breceit\w*\b/,
  /\b(?:dose|dosagem|medicamento|remedio|tratamento medico)\b/,
  /\b(?:o paciente|a paciente|voce|ele|ela)\b.{0,70}\b(?:tem|possui|apresenta|esta com|esta sofrendo|tem sinais de|quadro compativel com)\b.{0,70}\b(?:doenca|transtorno|diabet\w*|anorex\w*|bulim\w*)\b/,
  /\b(?:deve|precisa|recomendo|orientado a)?\s*(?:tomar|tome|usar|use|iniciar|inicie|suspender|suspenda|administrar|administre|aplicar|aplique|aumentar|aumente|reduzir|reduza)\b.{0,100}\b(?:mg|ml|comprimid\w*|medicamento|remedio|insulin\w*|antidepress\w*|antibiot\w*|suplement\w*|tratamento)\b/,
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isClinicalRequest(question: string | undefined) {
  return question ? CLINICAL_REQUEST_PATTERN.test(normalize(question)) : false;
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
