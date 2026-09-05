import {
  normalizeForMatching,
  normalizedTokenIncludes,
} from "./mealTextParsing";

const KNOWN_BRANDS = [
  "Nestlé",
  "Nestle",
  "Panco",
  "Wickbold",
  "Coca-Cola",
  "Coca Cola",
  "Molico",
  "Polenghi",
  "Danone",
  "Italac",
  "Piracanjuba",
  "Growth",
  "Catupiry",
  "Elma Chips",
  "Elma",
  "Bauducco",
  "Vigor",
  "Tirolez",
  "Qualy",
];

export function detectKnownBrand(value: string) {
  const normalized = normalizeForMatching(value);
  return (
    KNOWN_BRANDS.find(brand => normalizedTokenIncludes(normalized, brand)) ??
    null
  );
}
