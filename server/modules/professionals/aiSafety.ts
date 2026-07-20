import type { ProfessionalAiAssistantOutput } from "./aiSchemas";

const CLINICAL_REQUEST_PATTERN =
  /\b(diagnost|prescrev|prescricao|receit|dosagem|medicamento|remedio|doenca|transtorno|tratamento medico)\w*/;

const PROHIBITED_OUTPUT_PATTERNS = [
  /\bdiagn[oó]stic(?:o|a|ar|ado|ada|ou|amos|aram)\b/i,
  /\bprescrev\w*\b/i,
  /\bprescri[cç][aã]o\b/i,
  /\breceit(?:a|ar|ado|ada|e)\w*\b/i,
  /\bdosagem\b/i,
  /\b(?:medicamento|rem[eé]dio|tratamento m[eé]dico)\b/i,
  /\b(?:o paciente|a paciente|voc[eê]|ele|ela)\b.{0,50}\b(?:tem|possui|apresenta|est[aá] com)\b.{0,50}\b(?:doen[cç]a|transtorno|diabetes|anorexia|bulimia)\b/i,
  /\b(?:tome|use|inicie|suspenda|aumente|reduza)\b.{0,80}\b(?:mg|ml|comprimido|medicamento|rem[eé]dio|suplemento|tratamento)\b/i,
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
  const content = [
    output.title,
    output.summary,
    ...output.facts,
    ...output.interpretations,
    ...output.missingData,
    ...output.cautions,
    output.draft?.content ?? "",
  ].join("\n");

  if (PROHIBITED_OUTPUT_PATTERNS.some(pattern => pattern.test(content))) {
    throw new Error("professional_ai_prohibited_clinical_output");
  }
}
