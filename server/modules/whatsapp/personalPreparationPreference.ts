import type { WhatsappContextMemoryEntry } from "./contextMemory";
import {
  recordWhatsappMemoryFromFeedback,
  WHATSAPP_CONTEXT_MEMORY_VERSION,
} from "./contextMemory";
import { recordWhatsappUserFeedback } from "./feedbackLoop";
import {
  loadPersistedWhatsappContextMemories,
  persistWhatsappContextMemoryEntry,
} from "./persistentContextMemory";
import type { WhatsappIntentName } from "./intentSchema";

export type PersonalPreparationChoice = "without_sugar" | "with_sugar";

export type PersonalPreparationResolution =
  | { status: "applied"; choice: PersonalPreparationChoice; memory: WhatsappContextMemoryEntry }
  | { status: "missing" }
  | { status: "conflict"; memoryIds: number[] }
  | { status: "unavailable" };

export type PersistedPersonalPreparationSignal = {
  recognized: true;
  persisted: boolean;
  subject: string;
  choice: PersonalPreparationChoice;
  memory: WhatsappContextMemoryEntry | null;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticKey(subject: string) {
  return `food-preparation:${normalize(subject)}`;
}

function parseChoice(value: string): PersonalPreparationChoice | null {
  const normalized = normalize(value);
  if (/^(?:without sugar|sem (?:adicao de )?acucar|puro|preto|natural)$/.test(normalized)) {
    return "without_sugar";
  }
  if (/^(?:with sugar|com acucar|adocado|acucarado)$/.test(normalized)) {
    return "with_sugar";
  }
  return null;
}

function extractPreparationPhrase(text: string) {
  const normalized = normalize(text);
  const match = normalized.match(/\b(sem (?:adicao de )?acucar|puro|preto|natural|com acucar|adocado|acucarado)\b/);
  if (!match || match.index === undefined) return null;
  return {
    normalized,
    phrase: match[1],
    choice: parseChoice(match[1]),
    before: normalized.slice(0, match.index).trim(),
  };
}

function cleanSubject(value: string) {
  return value
    .replace(/^(?:o|a|um|uma)\s+/, "")
    .replace(/\s+(?:e|eh)$/i, "")
    .trim();
}

export function extractWhatsappReusablePreparationPreference(text?: string | null) {
  const source = text?.trim();
  if (!source) return null;
  const preparation = extractPreparationPhrase(source);
  if (!preparation?.choice) return null;

  const alias = preparation.normalized.match(
    /^(?:sempre que eu falar|quando eu falar)\s+(.+?)\s+(?:quer dizer|significa|e|eh)\s+(.+)$/,
  );
  if (alias) {
    const choice = parseChoice(alias[2]);
    const subject = cleanSubject(alias[1]);
    return choice && subject && !/\d/.test(subject) ? { subject, choice } : null;
  }

  const patterns = [
    /(?:^|\b)(?:normalmente|geralmente)\s+(?:eu\s+)?(?:tomo|bebo|consumo|uso|como)\s+(.+)$/,
    /(?:^|\b)(?:costumo|prefiro)\s+(?:tomar|beber|consumir|usar|comer)?\s*(.+)$/,
    /(?:^|\b)gosto\s+de\s+(.+)$/,
    /(?:^|\b)(?:meu|minha)\s+(.+?)\s+(?:e|eh)$/,
  ];

  let subject = "";
  for (const pattern of patterns) {
    const match = preparation.before.match(pattern);
    if (match?.[1]) {
      subject = cleanSubject(match[1]);
      break;
    }
  }

  if (!subject || /\d/.test(subject)) return null;
  return { subject, choice: preparation.choice };
}

export async function persistWhatsappReusablePreparationPreferenceFromText(input: {
  userId: number;
  text?: string | null;
  createdAt?: Date;
}): Promise<PersistedPersonalPreparationSignal | null> {
  const extracted = extractWhatsappReusablePreparationPreference(input.text);
  if (!extracted || !input.text) return null;

  const feedback = recordWhatsappUserFeedback({
    userId: input.userId,
    text: input.text,
    createdAt: input.createdAt,
  });
  if (feedback.status === "blocked" || feedback.scope !== "individual") {
    return {
      recognized: true,
      persisted: false,
      subject: extracted.subject,
      choice: extracted.choice,
      memory: null,
    };
  }

  const semanticFeedback = {
    ...feedback,
    targetIntent: "add_foods_to_meal" as const,
    generatedMemory: {
      ...feedback.generatedMemory,
      kind: feedback.kind === "personal_alias" ? "alias" as const : "preference" as const,
      scope: "user" as const,
      key: semanticKey(extracted.subject),
      value: extracted.choice,
      confidence: feedback.confidence,
    },
  };
  const localEntry = recordWhatsappMemoryFromFeedback(semanticFeedback);
  if (!localEntry || localEntry.scope !== "individual") {
    return {
      recognized: true,
      persisted: false,
      subject: extracted.subject,
      choice: extracted.choice,
      memory: null,
    };
  }

  localEntry.appliesToIntents = ["add_foods_to_meal"];
  localEntry.source.ruleVersion = WHATSAPP_CONTEXT_MEMORY_VERSION;
  const persisted = await persistWhatsappContextMemoryEntry(localEntry);
  return {
    recognized: true,
    persisted: Boolean(persisted),
    subject: extracted.subject,
    choice: extracted.choice,
    memory: persisted,
  };
}

function isActiveApplicableMemory(
  entry: WhatsappContextMemoryEntry,
  userId: number,
  key: string,
  intent: WhatsappIntentName | "unknown" | null,
  now: Date,
) {
  if (entry.scope !== "individual" || entry.userId !== userId) return false;
  if (entry.status !== "active" || entry.replacedByMemoryId) return false;
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now.getTime()) return false;
  if (entry.key !== key) return false;
  if (intent && entry.appliesToIntents.length > 0 && !entry.appliesToIntents.includes(intent)) return false;
  if (!["individual_preference", "individual_alias", "recurring_correction"].includes(entry.kind)) return false;
  return ["feedback", "review", "manual"].includes(entry.source.sourceType);
}

export async function resolveWhatsappPersonalPreparationPreference(input: {
  userId: number;
  subject: string;
  intent?: WhatsappIntentName | "unknown" | null;
  now?: Date;
}): Promise<PersonalPreparationResolution> {
  const memories = await loadPersistedWhatsappContextMemories(input.userId);
  if (memories === null) return { status: "unavailable" };

  const key = semanticKey(input.subject);
  const now = input.now ?? new Date();
  const applicable = memories.filter(entry =>
    isActiveApplicableMemory(entry, input.userId, key, input.intent ?? null, now));
  if (!applicable.length) return { status: "missing" };

  const choices = new Map<PersonalPreparationChoice, WhatsappContextMemoryEntry[]>();
  for (const entry of applicable) {
    const choice = parseChoice(entry.value);
    if (!choice) continue;
    const existing = choices.get(choice) ?? [];
    existing.push(entry);
    choices.set(choice, existing);
  }
  if (!choices.size) return { status: "missing" };
  if (choices.size > 1) {
    return { status: "conflict", memoryIds: [...choices.values()].flat().map(entry => entry.id) };
  }

  const [choice, entries] = [...choices.entries()][0];
  const memory = [...entries].sort((a, b) =>
    (b.priority + b.confidence) - (a.priority + a.confidence)
      || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  return { status: "applied", choice, memory };
}

export function applyPersonalPreparationChoiceToFoodMention(input: {
  text: string;
  foodPattern: RegExp;
  choice: PersonalPreparationChoice;
}) {
  const preparation = input.choice === "without_sugar" ? "sem açúcar" : "com açúcar";
  return input.text.replace(input.foodPattern, match => `${match} ${preparation}`);
}
