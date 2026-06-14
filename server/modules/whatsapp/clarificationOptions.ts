export type WhatsappClarificationOption = {
  id: string;
  label: string;
  value?: unknown;
};

export type WhatsappClarificationSelection =
  | { kind: "selected"; selectedNumber: number; option: WhatsappClarificationOption }
  | { kind: "cancelled" }
  | { kind: "out_of_range"; selectedNumber: number; optionCount: number };

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildWhatsappClarificationPrompt(input: {
  question: string;
  options: WhatsappClarificationOption[];
  footer?: string;
}) {
  const optionLines = input.options.map((option, index) => `${index + 1}. ${option.label}`);
  return [
    input.question.trim(),
    ...optionLines,
    input.footer ?? "Responda com o número da opção ou escreva cancelar.",
  ].filter(Boolean).join("\n");
}

export function parseWhatsappClarificationSelection(text: string, options: WhatsappClarificationOption[]): WhatsappClarificationSelection | null {
  const normalized = normalizeText(text);
  if (/^(cancelar|cancela|nenhuma|nenhum|nao|não|n)$/.test(normalized)) {
    return { kind: "cancelled" };
  }

  const digitMatch = normalized.match(/^(?:opcao\s+)?(\d+)$/);
  let selectedNumber = digitMatch ? Number(digitMatch[1]) : null;

  const ordinals = new Map<string, number>([
    ["primeira", 1],
    ["primeiro", 1],
    ["segunda", 2],
    ["segundo", 2],
    ["terceira", 3],
    ["terceiro", 3],
    ["quarta", 4],
    ["quarto", 4],
    ["quinta", 5],
    ["quinto", 5],
    ["sexta", 6],
    ["sexto", 6],
    ["setima", 7],
    ["setimo", 7],
    ["oitava", 8],
    ["oitavo", 8],
    ["nona", 9],
    ["nono", 9],
    ["decima", 10],
    ["decimo", 10],
  ]);

  if (selectedNumber == null) {
    for (const [word, value] of ordinals) {
      if (new RegExp(`^(?:a |o )?${word}(?: opcao)?$`).test(normalized)) {
        selectedNumber = value;
        break;
      }
    }
  }

  if (selectedNumber == null && /^(?:a |o )?ultima(?: opcao)?$/.test(normalized)) {
    selectedNumber = options.length;
  }

  if (selectedNumber == null) {
    const byText = options.findIndex(option => normalizeText(option.label) === normalized || normalizeText(option.label).includes(normalized));
    if (byText >= 0) selectedNumber = byText + 1;
  }

  if (selectedNumber == null) return null;
  const option = options[selectedNumber - 1] ?? null;
  if (!option) return { kind: "out_of_range", selectedNumber, optionCount: options.length };
  return { kind: "selected", selectedNumber, option };
}
