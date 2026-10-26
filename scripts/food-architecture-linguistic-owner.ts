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
      // Exact morphology-only lexemes with values fixed by grammar. A food
      // name, altered quantity, added property or hidden nutrition map is not
      // covered by this exception even inside the canonical owner.
      const values: Readonly<Record<string, number>> = {
        um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4,
        cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
        onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14,
        quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17,
        dezoito: 18, dezenove: 19,
        vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
        sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
        cem: 100, cento: 100, duzentos: 200, duzentas: 200,
        trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
        quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
        setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
        novecentos: 900, novecentas: 900,
        meio: 0.5, meia: 0.5,
      };
      const pairs = [...finding.subject.matchAll(/\b([a-z]+)\s*:\s*(\d+(?:\.\d+)?)/g)];
      const residue = finding.subject.replace(/\b([a-z]+)\s*:\s*(\d+(?:\.\d+)?)/g, "")
        .replace(/[{},\s]/g, "");
      return pairs.length >= 10 && residue === "" &&
        new Set(pairs.map(match => match[1])).size === pairs.length &&
        pairs.every(match => Object.prototype.hasOwnProperty.call(values, match[1]) &&
          values[match[1]] === Number(match[2]));
    }
    if (file === "server/modules/foodIntelligenceV2/linguisticSurface.ts" &&
        ["17", "5"].includes(rule.id) && rule.kind === "numeric-map" &&
        finding.symbol === "vulgar:numeric-food-map") {
      return /^\{\s*"¼"\s*:\s*0\.25\s*,\s*"½"\s*:\s*0\.5\s*,\s*"¾"\s*:\s*0\.75\s*\}$/u.test(
        finding.subject,
      );
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
      // A-031: "cha"/"cafe" are accent-folded subtypes of a spoon measure.
      // Exempt only these two exact structural comparisons in the canonical
      // quantity reader. Unknown foods, new literals, operators and owners
      // must still be reported by architecture rule 18.
      if (file === "server/modules/foodIntelligenceV2/linguisticSurface.ts" &&
          rule.id === "18" && rule.kind === "literal-branch" &&
          finding.symbol === "readQuantity:qualifier:lexical-branch" &&
          /^qualifier\s*===\s*"(?:cha|cafe)"$/u.test(finding.subject)) return true;
    }
    // A-039: transcript-confidence metadata is gated by an exact modality
    // discriminator. This does not compare or resolve food identity.
    // Exempt only this expression in the canonical comprehension function;
    // other operands, operators, owners and files remain covered by rule 18.
    if (file === "server/modules/foodIntelligenceV2/linguisticComprehension.ts" &&
        rule.id === "18" && rule.kind === "literal-branch" &&
        finding.symbol === "comprehendFoodLanguage:request.modality:lexical-branch" &&
        finding.subject === 'request.modality !== "audio_transcript"') return true;
    // Exact discriminants of the modality/OCR/lexicon contracts are not
    // nutrition or food-attribute decisions. Keep this narrow: new literals,
    // owners and comparison operands remain subject to architecture rules.
    if (rule.id === "18" && rule.kind === "literal-branch") {
      const predicate = finding.subject.match(
        /^(request\.modality|request\.imageRegionRole|item\.targetType|entry\.kind)\s*(===|!==)\s*"([a-z_]+)"$/u,
      );
      const contractValues: Record<string, readonly string[]> = {
        "request.modality": ["image"],
        "request.imageRegionRole": ["front_identity", "caption", "nutrition_label", "ingredients"],
        "item.targetType": ["canonical_term"],
        // Only the approved S2 protection marker is structural grammar.
        "entry.kind": ["protected_token"],
      };
      const owner = predicate?.[1] === "item.targetType" &&
        finding.symbol === "governedUnitAliases:item.targetType:lexical-branch"
        ? "governedUnitAliases" : "comprehendFoodLanguage";
      // Negating the marker changes the guard; do not whitelist that branch.
      if (predicate?.[1] === "entry.kind" && predicate[2] !== "===") return false;
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
