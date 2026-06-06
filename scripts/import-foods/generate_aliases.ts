import { normalizeFoodName } from "./normalize_food_name.ts";

const FOOD_SYNONYMS = new Map<string, string[]>([
  ["arroz branco", ["arroz", "arroz cozido"]],
  ["feijao carioca", ["feijao", "feijao carioquinha"]],
  ["feijao preto", ["feijao preto cozido"]],
  ["pao frances", ["pao de sal", "cacete"]],
  ["mandioca", ["aipim", "macaxeira"]],
  ["abobora", ["jerimum"]],
  ["mexerica", ["tangerina", "bergamota"]],
  ["banana prata", ["banana"]],
  ["cafe com leite", ["pingado"]],
]);

export function generateAliases(name: string, explicitAliases: string[] = []) {
  const normalized = normalizeFoodName(name);
  const aliases = new Set<string>();

  aliases.add(name.trim());
  aliases.add(normalized);

  const withoutPreparation = normalized.replace(/\b(cozido|cozida|assado|assada|grelhado|grelhada|cru|crua)\b/g, "").replace(/\s+/g, " ").trim();
  if (withoutPreparation && withoutPreparation !== normalized) {
    aliases.add(withoutPreparation);
  }

  for (const [key, values] of FOOD_SYNONYMS.entries()) {
    if (normalized.includes(key)) {
      values.forEach(alias => aliases.add(alias));
    }
  }

  explicitAliases.forEach(alias => {
    if (alias.trim()) aliases.add(alias.trim());
  });

  return Array.from(aliases).map(alias => ({
    alias,
    normalizedAlias: normalizeFoodName(alias),
  }));
}
