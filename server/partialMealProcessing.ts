import { calculateMealTotals } from "../shared/mealTotals";
import {
  MealInferenceError,
  processMealInput,
  type MealProcessingInput,
  type MealProcessingResult,
} from "./nutritionEngine";
import { splitFoodTextSegments } from "./mealTextParsing";
import { buildMealSemanticContract } from "./mealSemanticContract";
import type { ResolvedRegistrationSegment } from "./modules/whatsapp/countableFoodRegistrationGate";

export type PartialMealProcessingFailure = {
  segmentIndex: number;
  segment: string;
  reason: string;
};

export type PartialMealProcessingResult = {
  processed: MealProcessingResult;
  skippedSegments: PartialMealProcessingFailure[];
};

export type PartialMealProcessingOptions = {
  containsMedia?: boolean;
  hasTranscriptionFailure?: boolean;
};

function buildSegmentInput(input: MealProcessingInput, segment: string) {
  return {
    ...input,
    text: segment,
    transcript: undefined,
    imageUrl: undefined,
    audioUrl: undefined,
  } satisfies MealProcessingInput;
}

function getFailureReason(error: unknown) {
  if (error instanceof MealInferenceError && error.message.trim()) {
    return error.message.trim();
  }
  return "não foi possível validar o alimento com segurança";
}

function isPartialRegistrationEligibleError(error: unknown) {
  return (
    error instanceof MealInferenceError &&
    (error.code === "food_component_quantity_required" ||
      error.code === "food_identity_clarification_required")
  );
}

function combineSuccessfulSegments(
  input: MealProcessingInput,
  parts: MealProcessingResult[]
) {
  const items = parts.flatMap(part => part.items);
  const first = parts[0];
  const sourceText = input.text?.trim() || first.sourceText;
  return {
    ...first,
    sourceText,
    transcript: input.transcript,
    imageUrl: input.imageUrl,
    audioUrl: input.audioUrl,
    items,
    totals: calculateMealTotals(items),
    semanticContract: buildMealSemanticContract({
      processingInput: input,
      sourceText,
      items,
    }),
  } satisfies MealProcessingResult;
}

async function processSegmentsIndividually(
  input: MealProcessingInput,
  segments: string[],
  resolvedSegments: ResolvedRegistrationSegment[],
  initialError?: unknown
): Promise<PartialMealProcessingResult> {
  const parts: MealProcessingResult[] = [];
  const skippedSegments: PartialMealProcessingFailure[] = [];
  const savedByIndex = new Map(
    resolvedSegments.map(segment => [segment.segmentIndex, segment.processed])
  );
  let firstError = initialError;

  for (const [segmentIndex, segment] of segments.entries()) {
    const saved = savedByIndex.get(segmentIndex);
    if (saved) {
      parts.push(saved);
      continue;
    }

    try {
      parts.push(await processMealInput(buildSegmentInput(input, segment)));
    } catch (error) {
      firstError ??= error;
      if (!isPartialRegistrationEligibleError(error)) throw error;
      skippedSegments.push({
        segmentIndex,
        segment,
        reason: getFailureReason(error),
      });
    }
  }

  if (!parts.length) {
    throw firstError ?? new MealInferenceError();
  }

  return {
    processed: combineSuccessfulSegments(input, parts),
    skippedSegments,
  };
}

/**
 * Processa refeições textuais compostas de forma tolerante a falhas isoladas.
 *
 * O caminho normal continua sendo uma única chamada ao motor nutricional. Só
 * quando essa chamada falha, ou quando já existe um segmento materializado pelo
 * gate contável, os segmentos são processados separadamente. Assim, uma
 * inconsistência alimentar não impede o registro dos demais itens válidos.
 */
export async function processMealInputWithPartialFailures(
  input: MealProcessingInput,
  resolvedSegments: ResolvedRegistrationSegment[] = [],
  options: PartialMealProcessingOptions = {}
): Promise<PartialMealProcessingResult> {
  const text = input.text?.trim() ?? "";
  const segments = splitFoodTextSegments(text);
  const isPlainTextInput = !input.imageUrl && !input.audioUrl && !input.transcript;

  if (
    !isPlainTextInput ||
    options.containsMedia ||
    options.hasTranscriptionFailure
  ) {
    return {
      processed: await processMealInput(input),
      skippedSegments: [],
    };
  }

  if (segments.length === 0) {
    return {
      processed: await processMealInput(input),
      skippedSegments: [],
    };
  }

  if (segments.length <= 1 && resolvedSegments.length === 0) {
    return {
      processed: await processMealInput(input),
      skippedSegments: [],
    };
  }

  if (resolvedSegments.length > 0) {
    return processSegmentsIndividually(input, segments, resolvedSegments);
  }

  try {
    return {
      processed: await processMealInput(input),
      skippedSegments: [],
    };
  } catch (error) {
    if (!isPartialRegistrationEligibleError(error) || segments.length <= 1) {
      throw error;
    }
    return processSegmentsIndividually(input, segments, [], error);
  }
}
