/**
 * #1341: independently authored material-fact references for the canonical corpus.
 * These are expected facts, never parser outputs or nutritional truth claims.
 * Holdout examples must not be supplied to S2 aliases or S3 prompts.
 */
export type C1bFactKind = "food-quantity" | "food-mention" | "ingredient-quantity" | "negation" | "unbound";
export type C1bFact = {
  kind: C1bFactKind;
  /** Literal owner from the original input, null when attachment is ambiguous. */
  owner: string | null;
  /** Independent alternatives for a continuation with no uniquely attributable owner. */
  ownerAlternatives?: readonly string[];
  uncertaintyReason?: "owner-ambiguous-after-coordinated-items";
  requiresAbstention?: true;
  /** Exact claim substring: its offset is located independently of either parser. */
  surface: string;
  /** Explicit UTF-16 start for a repeated literal; never inferred from parser output. */
  surfaceStart?: number;
  /** Explicit UTF-16 start when the labelled scope also repeats verbatim. */
  scopeStart?: number;
  /** Exact, independently labelled clause containing the claim and its owner. */
  scope: string;
  ingredient: string | null;
  quantity: number | null;
  unit: string | null;
};
export type C1bCase = {
  id: string;
  text: string;
  modality: "text" | "audio_transcript";
  split: "calibration" | "holdout";
  semanticGroup: string;
  facts: readonly C1bFact[];
};
const ingredient = (owner: string, scope: string, surface: string, quantity: number,
  unit: string): C1bFact => ({ kind: "ingredient-quantity", owner, scope, surface,
    ingredient: "açúcar", quantity, unit });
const food = (owner: string, surface: string, quantity: number, unit: string): C1bFact =>
  ({ kind: "food-quantity", owner, scope: surface, surface,
    ingredient: null, quantity, unit });
const foodMention = (name: string): C1bFact =>
  ({ kind: "food-mention", owner: name, scope: name, surface: name,
    ingredient: null, quantity: null, unit: null });
const without = (owner: string, scope: string): C1bFact =>
  ({ kind: "negation", owner, scope, surface: "sem açúcar", ingredient: "açúcar",
    quantity: null, unit: null });
const unbound = (scope: string, surface: string, quantity: number | null = null,
  unit: string | null = null): C1bFact =>
  ({ kind: "unbound", owner: null, scope, surface, ingredient: "açúcar", quantity, unit,
    ownerAlternatives: ["café", "pudim"],
    uncertaintyReason: "owner-ambiguous-after-coordinated-items", requiresAbstention: true });

/** Human-authored labels: no prediction is used to derive a reference. */
export const c1bCases: readonly C1bCase[] = [
  {
    id: "sugar-owners-original", semanticGroup: "coffee1-pudding2spoons", split: "holdout", modality: "text",
    text: "café com uma colher de chá de açúcar e um pudim com duas colheres de chá de açúcar",
    facts: [
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
      ingredient("pudim", "um pudim com duas colheres de chá de açúcar", "duas colheres de chá de açúcar", 2, "colher de chá"),
    ],
  },
  {
    id: "sugar-owners-reversed", semanticGroup: "coffee1-pudding2spoons", split: "holdout", modality: "text",
    text: "um pudim com duas colheres de chá de açúcar e café com uma colher de chá de açúcar",
    facts: [
      ingredient("pudim", "um pudim com duas colheres de chá de açúcar", "duas colheres de chá de açúcar", 2, "colher de chá"),
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
    ],
  },
  {
    id: "sugar-owners-comma", semanticGroup: "coffee1-pudding2spoons", split: "holdout", modality: "text",
    text: "café com uma colher de chá de açúcar, um pudim com duas colheres de chá de açúcar",
    facts: [
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
      ingredient("pudim", "um pudim com duas colheres de chá de açúcar", "duas colheres de chá de açúcar", 2, "colher de chá"),
    ],
  },
  {
    id: "sugar-owners-numeric", semanticGroup: "coffee1-pudding2spoons", split: "holdout", modality: "text",
    text: "café com 1 colher de chá de açúcar e um pudim com 2 colheres de chá de açúcar",
    facts: [
      ingredient("café", "café com 1 colher de chá de açúcar", "1 colher de chá de açúcar", 1, "colher de chá"),
      ingredient("pudim", "um pudim com 2 colheres de chá de açúcar", "2 colheres de chá de açúcar", 2, "colher de chá"),
    ],
  },
  {
    id: "sugar-owners-transcript", semanticGroup: "coffee1-pudding2spoons", split: "holdout", modality: "audio_transcript",
    text: "cafe com uma colher de cha de acucar e um pudim com duas colheres de cha de acucar",
    facts: [
      ingredient("cafe", "cafe com uma colher de cha de acucar", "uma colher de cha de acucar", 1, "colher de chá"),
      ingredient("pudim", "um pudim com duas colheres de cha de acucar", "duas colheres de cha de acucar", 2, "colher de chá"),
    ],
  },
  {
    id: "sugar-gram-other-food", semanticGroup: "coffee1-pudding2g", split: "calibration", modality: "text",
    text: "café com uma colher de chá de açúcar e um pudim com 2 g de açúcar",
    facts: [
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
      ingredient("pudim", "um pudim com 2 g de açúcar", "2 g de açúcar", 2, "g"),
    ],
  },
  {
    id: "sugar-gram-reversed", semanticGroup: "coffee1-pudding2g", split: "calibration", modality: "text",
    text: "um pudim com 2 g de açúcar e café com uma colher de chá de açúcar",
    facts: [
      ingredient("pudim", "um pudim com 2 g de açúcar", "2 g de açúcar", 2, "g"),
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
    ],
  },
  {
    id: "sugar-extra-unbound", semanticGroup: "coffee1-pudding2-plus-unbound", split: "holdout", modality: "text",
    text: "café com uma colher de chá de açúcar e um pudim com duas colheres de chá de açúcar e mais açúcar",
    facts: [
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
      ingredient("pudim", "um pudim com duas colheres de chá de açúcar", "duas colheres de chá de açúcar", 2, "colher de chá"),
      unbound("mais açúcar", "mais açúcar"),
    ],
  },
  {
    id: "sugar-extra-gram", semanticGroup: "coffee1-pudding2-plus-1g-unbound", split: "holdout", modality: "text",
    text: "café com uma colher de chá de açúcar e um pudim com duas colheres de chá de açúcar e mais 1 g de açúcar",
    facts: [
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
      ingredient("pudim", "um pudim com duas colheres de chá de açúcar", "duas colheres de chá de açúcar", 2, "colher de chá"),
      unbound("mais 1 g de açúcar", "mais 1 g de açúcar", 1, "g"),
    ],
  },
  {
    id: "sugar-local-negation", semanticGroup: "coffee-zero-pudding2", split: "calibration", modality: "text",
    text: "café sem açúcar e um pudim com duas colheres de chá de açúcar",
    facts: [
      without("café", "café sem açúcar"),
      ingredient("pudim", "um pudim com duas colheres de chá de açúcar", "duas colheres de chá de açúcar", 2, "colher de chá"),
    ],
  },
  {
    id: "sugar-other-negation", semanticGroup: "coffee1-pudding-zero", split: "holdout", modality: "text",
    text: "café com uma colher de chá de açúcar e um pudim sem açúcar",
    facts: [
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
      without("pudim", "um pudim sem açúcar"),
    ],
  },
  {
    id: "sugar-other-beverage", semanticGroup: "coffee1-tea3", split: "holdout", modality: "text",
    text: "café com uma colher de chá de açúcar e chá com três colheres de chá de açúcar",
    facts: [
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
      ingredient("chá", "chá com três colheres de chá de açúcar", "três colheres de chá de açúcar", 3, "colher de chá"),
    ],
  },
  {
    id: "measure-word-food-name", semanticGroup: "brigadeiro-name-coffee1", split: "holdout", modality: "text",
    text: "brigadeiro de colher e café com uma colher de chá de açúcar",
    facts: [foodMention("brigadeiro de colher"),
      ingredient("café", "café com uma colher de chá de açúcar", "uma colher de chá de açúcar", 1, "colher de chá"),
    ],
  },
  {
    id: "food-count-simple", semanticGroup: "eggs2-banana1", split: "calibration", modality: "text",
    text: "2 ovos e 1 banana",
    facts: [food("ovos", "2 ovos", 2, "un"), food("banana", "1 banana", 1, "un")],
  },
  {
    id: "food-count-reversed", semanticGroup: "eggs2-banana1", split: "calibration", modality: "text",
    text: "1 banana e 2 ovos",
    facts: [food("banana", "1 banana", 1, "un"), food("ovos", "2 ovos", 2, "un")],
  },
  {
    // Distinct facts for one food in a single sentence, including a repeated
    // value. Both owner occurrences must remain independently observable.
    id: "food-repeated-equal", semanticGroup: "eggs2-plus-eggs2", split: "calibration", modality: "text",
    text: "2 ovos e mais dois ovos",
    facts: [
      { ...food("ovos", "2 ovos", 2, "un"), scope: "2 ovos e mais dois ovos" },
      { ...food("ovos", "dois ovos", 2, "un"), scope: "2 ovos e mais dois ovos" },
    ],
  },
  {
    // Both quantities have the identical surface text but distinct original
    // UTF-16 occurrences. An unqualified indexOf would silently merge them.
    id: "food-repeated-literal", semanticGroup: "eggs2-plus-eggs2", split: "calibration", modality: "text",
    text: "2 ovos e mais 2 ovos",
    facts: [
      { ...food("ovos", "2 ovos", 2, "un"), scope: "2 ovos e mais 2 ovos", surfaceStart: 0 },
      { ...food("ovos", "2 ovos", 2, "un"), scope: "2 ovos e mais 2 ovos", surfaceStart: 14 },
    ],
  },
  {
    id: "food-repeated-distinct", semanticGroup: "eggs2-plus-eggs3", split: "calibration", modality: "text",
    text: "2 ovos e mais 3 ovos",
    facts: [
      { ...food("ovos", "2 ovos", 2, "un"), scope: "2 ovos e mais 3 ovos" },
      { ...food("ovos", "3 ovos", 3, "un"), scope: "2 ovos e mais 3 ovos" },
    ],
  },
  {
    id: "food-units", semanticGroup: "bread1-milk200", split: "calibration", modality: "text",
    text: "1 fatia de pão e 200 ml de leite",
    facts: [food("pão", "1 fatia de pão", 1, "fatia"), food("leite", "200 ml de leite", 200, "ml")],
  },
  {
    id: "food-written-fraction", semanticGroup: "mortadella1.5", split: "holdout", modality: "text",
    text: "uma fatia e meia de mortadela",
    facts: [food("mortadela", "uma fatia e meia de mortadela", 1.5, "fatia")],
  },
  {
    id: "food-decimal-fraction", semanticGroup: "mortadella1.5", split: "holdout", modality: "text",
    text: "1,5 fatias de mortadela",
    facts: [food("mortadela", "1,5 fatias de mortadela", 1.5, "fatia")],
  },
];
