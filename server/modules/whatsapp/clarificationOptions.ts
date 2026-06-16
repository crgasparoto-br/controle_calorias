export type WhatsappClarificationOption = {
  id: string;
  label: string;
  value: Record<string, unknown>;
};

export function buildWhatsappClarificationPrompt(input: {
  question: string;
  options: WhatsappClarificationOption[];
  noneLabel?: string;
}) {
  const noneLabel = input.noneLabel ?? "Nenhuma dessas opções";
  return [
    input.question,
    "",
    ...input.options.map((option, index) => `${index + 1}. ${option.label}`),
    `0. ${noneLabel}`,
    "",
    "Responda com o número, como '1', 'opção 1' ou 'a primeira'. Envie 'nenhuma' ou 'cancelar' se não for uma dessas opções.",
  ].join("\n");
}

export function buildWhatsappClarificationOptionsData(options: WhatsappClarificationOption[]) {
  return {
    optionCount: options.length,
    options,
    acceptedResponses: ["1", "opção 1", "a primeira", "nenhuma", "cancelar"],
  };
}
