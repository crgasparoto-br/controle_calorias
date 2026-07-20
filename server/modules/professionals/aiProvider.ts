import type { InvokeResult } from "../../_core/llm";
import {
  professionalAiAssistantOutputSchema,
  professionalAiQuestionFocusOutputSchema,
  type ProfessionalAiAssistantOutput,
  type ProfessionalAiGenerateInput,
  type ProfessionalAiQuestionFocus,
} from "./aiSchemas";
import { assertProfessionalAiOutputIsSafe } from "./aiSafety";
import {
  validateProfessionalAiSourceReferences,
  type ProfessionalAiSourceSignal,
} from "./aiTraceability";
import { PROFESSIONAL_AI_NOTICE } from "./aiContext";

function parseJsonContent(
  content: InvokeResult["choices"][number]["message"]["content"]
) {
  const text = Array.isArray(content)
    ? content
        .filter(part => part.type === "text")
        .map(part => part.text)
        .join("\n")
    : content;
  const normalized = String(text ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(normalized);
}

export function parseProfessionalAiAssistantContent(
  content: InvokeResult["choices"][number]["message"]["content"]
) {
  return parseJsonContent(content);
}

export function parseProfessionalAiQuestionFocusContent(
  content: InvokeResult["choices"][number]["message"]["content"]
): ProfessionalAiQuestionFocus {
  return professionalAiQuestionFocusOutputSchema.parse(parseJsonContent(content)).focus;
}

export function professionalAiQuestionFocusProviderSchema() {
  return {
    name: "professional_ai_question_focus",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        focus: {
          type: "string",
          enum: [
            "overview",
            "records",
            "adherence",
            "macros",
            "water",
            "exercise",
            "weight",
            "food_quality",
            "alerts",
            "clinical_boundary",
          ],
        },
      },
      required: ["focus"],
    },
  } as const;
}

export function professionalAiProviderOutputSchema() {
  const sourceReferenceList = {
    type: "array",
    minItems: 1,
    maxItems: 12,
    items: { type: "string" },
  } as const;
  return {
    name: "professional_ai_assistance",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        summarySourceKeys: sourceReferenceList,
        facts: { type: "array", items: { type: "string" } },
        factSourceKeys: { type: "array", items: sourceReferenceList },
        interpretations: { type: "array", items: { type: "string" } },
        interpretationSourceKeys: {
          type: "array",
          items: sourceReferenceList,
        },
        missingData: { type: "array", items: { type: "string" } },
        cautions: { type: "array", items: { type: "string" } },
        draft: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                messageType: {
                  type: "string",
                  enum: [
                    "guidance",
                    "reminder",
                    "weigh_in_request",
                    "record_request",
                    "administrative",
                    "follow_up_summary",
                  ],
                },
                content: { type: "string" },
              },
              required: ["messageType", "content"],
            },
            { type: "null" },
          ],
        },
        educationalNotice: { type: "string" },
      },
      required: [
        "title",
        "summary",
        "summarySourceKeys",
        "facts",
        "factSourceKeys",
        "interpretations",
        "interpretationSourceKeys",
        "missingData",
        "cautions",
        "draft",
        "educationalNotice",
      ],
    },
  } as const;
}

export async function withProfessionalAiTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("professional_ai_provider_timeout")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function normalizeProfessionalAiProviderOutput(
  input: ProfessionalAiGenerateInput,
  rawOutput: unknown,
  sourceSignals: ProfessionalAiSourceSignal[],
  canonicalFacts: {
    facts: string[];
    factSourceKeys: string[][];
  },
  canonicalMissingData: string[]
): ProfessionalAiAssistantOutput {
  const output = professionalAiAssistantOutputSchema.parse(rawOutput);
  assertProfessionalAiOutputIsSafe(output);
  validateProfessionalAiSourceReferences(output, sourceSignals);
  const draft =
    input.mode === "draft" && input.draftType && output.draft
      ? { ...output.draft, messageType: input.draftType }
      : null;
  return {
    ...output,
    facts: canonicalFacts.facts,
    factSourceKeys: canonicalFacts.factSourceKeys,
    missingData: canonicalMissingData,
    draft,
    educationalNotice: PROFESSIONAL_AI_NOTICE,
  };
}
