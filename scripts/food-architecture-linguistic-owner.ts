/** Canonical syntax exemptions for V2 architecture; intentionally scoped to
 * the registered linguistic owners so nutrition maps remain prohibited.
 */
/**
 * ADR §4.1: the canonical LCL must implement numeric/lexical grammar without
 * becoming a competing food-identity or nutrition rule engine.
 *
 * Only these audited grammar expressions in this *specific* owner are exempt
 * from the wave-one generic lexical candidate heuristic. Food-specific maps,
 * unknown functions and channel/adapters remain fully checked. This is not a
 * blanket file or directory exclusion.
 */
export function isCanonicalLinguisticGrammar(
  file: string, rule: { id: string; kind: string }, finding: { symbol: string; subject: string },
): boolean {
  if (file === "server/modules/foodIntelligenceV2/linguisticComprehension.ts" ||
      file === "server/modules/foodIntelligenceV2/linguisticSurface.ts") {
    if (["17", "5"].includes(rule.id) && rule.kind === "numeric-map" &&
        finding.symbol === "writtenNumbers:numeric-food-map") {
      const keys = new Set(["um", "uma", "dois", "duas", "tres", "quatro", "cinco", "seis",
        "sete", "oito", "nove", "dez", "meio", "meia"]);
      const pairs = [...finding.subject.matchAll(/\b([a-z]+)\s*:\s*(\d+(?:\.\d+)?)/g)];
      return pairs.length >= 10 && pairs.every(match =>
        keys.has(match[1]) && Number(match[2]) >= 0.5 && Number(match[2]) <= 10);
    }
    if (["17", "18"].includes(rule.id)) {
      const regexGrammar = /^(?:foldFoodSurface|parseNumber|readQuantity|splitFoodSurface|foodOnlySpan|qualifierKey):lexical-regex$/u;
      if (regexGrammar.test(finding.symbol) &&
          rule.kind === "literal-regex-test") return true;
      if (finding.symbol === "recognizedUnit:lexical-dictionary" &&
          rule.kind === "lexical-lookup" &&
          /^unitMap\s*\[\s*foldFoodSurface\s*\(/u.test(finding.subject)) return true;
      if (finding.symbol === "splitFoodSurface:char:lexical-branch" &&
          rule.kind === "literal-branch") return true;
    }
    // Exact discriminants of the modality/OCR/lexicon contracts are not
    // nutrition or food-attribute decisions. Keep this narrow: new literals,
    // owners and comparison operands remain subject to architecture rules.
    if (rule.id === "18" && rule.kind === "literal-branch") {
      const predicate = finding.subject.match(
        /^(request\.modality|request\.imageRegionRole|item\.targetType)\s*(===|!==)\s*"([a-z_]+)"$/u,
      );
      const contractValues: Record<string, readonly string[]> = {
        "request.modality": ["image"],
        "request.imageRegionRole": ["front_identity", "caption", "nutrition_label", "ingredients"],
        "item.targetType": ["canonical_term"],
      };
      const owner = predicate?.[1] === "item.targetType" &&
        finding.symbol === "governedUnitAliases:item.targetType:lexical-branch"
        ? "governedUnitAliases" : "comprehendFoodLanguage";
      if (predicate &&
          finding.symbol === `${owner}:${predicate[1]}:lexical-branch` &&
          contractValues[predicate[1]]?.includes(predicate[3])) return true;
    }
    // Selecting already validated, versioned lexicon rows is not a second
    // identity resolver; the nutrition/food resolver remains elsewhere.
    if (rule.id === "2" && rule.kind === "function" &&
        finding.symbol === "selectLexicon") return true;
  }
  // A dynamic store callback holding no food catalog is not a literal food map.
  return file === "server/modules/foodIntelligenceV2/linguisticLexiconRepository.ts" &&
    rule.id === "17" && rule.kind === "collection" &&
    finding.symbol === "governedLinguisticLexiconStore" &&
    /\bload\b/u.test(finding.subject) && !/\b(?:calories|protein|carbs|fat)\s*:/iu.test(finding.subject);
}
