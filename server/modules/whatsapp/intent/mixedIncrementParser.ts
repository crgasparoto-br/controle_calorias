import { parseQuantityChange } from "../../../../shared/mixedQuantityChangeGrammar";

export type {
  MixedIncrementUnit,
  ParsedMixedIncrementCommand,
  ParsedMixedIncrementOperation,
} from "../../../../shared/mixedQuantityChangeGrammar";

export { parseQuantityChange } from "../../../../shared/mixedQuantityChangeGrammar";

import type { ParsedMixedIncrementCommand } from "../../../../shared/mixedQuantityChangeGrammar";

/** WhatsApp adapter retaining the intent parser API while delegating grammar ownership. */
export function parseMixedMealItemIncrementCommand(
  text: string
): ParsedMixedIncrementCommand | null {
  return parseQuantityChange(text);
}
