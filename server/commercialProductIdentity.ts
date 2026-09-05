type CommercialMeasure = {
  kind: "mass" | "volume";
  value: number;
};

const COMMERCIAL_GENERIC_TOKENS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "barra",
  "barras",
  "biscoito",
  "biscoitos",
  "bolacha",
  "bolachas",
  "bombom",
  "bombons",
  "chocolate",
  "cookie",
  "cookies",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "doce",
  "doces",
  "e",
  "embalado",
  "embalada",
  "embalagem",
  "em",
  "g",
  "gr",
  "grama",
  "gramas",
  "kg",
  "l",
  "ml",
  "mg",
  "o",
  "os",
  "pacote",
  "pacotes",
  "porcao",
  "produto",
  "sabor",
  "unidade",
  "unidades",
  "wafer",
  "wafers",
]);

const COMMERCIAL_VARIANT_TOKENS = new Set([
  "amargo",
  "avela",
  "baunilha",
  "branco",
  "caramelo",
  "coco",
  "dark",
  "diet",
  "duo",
  "integral",
  "laranja",
  "light",
  "limao",
  "maxi",
  "menta",
  "mini",
  "morango",
  "premium",
  "recheado",
  "recheada",
  "tradicional",
  "trufa",
  "trufado",
  "trufada",
  "zero",
]);

function normalizeCommercialText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9,.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCommercialTokens(value: string) {
  return normalizeCommercialText(value)
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|mg|ml|g|l)\b/g, " ")
    .split(/\s+/g)
    .map(token => token.replace(/[,.]/g, ""))
    .filter(
      token =>
        token.length >= 2 &&
        !COMMERCIAL_GENERIC_TOKENS.has(token) &&
        !/^\d+$/.test(token)
    );
}

function extractCommercialMeasures(value: string): CommercialMeasure[] {
  const normalized = normalizeCommercialText(value);
  const measures: CommercialMeasure[] = [];
  const pattern = /\b(\d+(?:[,.]\d+)?)\s*(kg|mg|ml|g|l)\b/g;
  for (const match of normalized.matchAll(pattern)) {
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount)) continue;
    const unit = match[2];
    if (unit === "kg") measures.push({ kind: "mass", value: amount * 1000 });
    else if (unit === "mg")
      measures.push({ kind: "mass", value: amount / 1000 });
    else if (unit === "g") measures.push({ kind: "mass", value: amount });
    else if (unit === "l")
      measures.push({ kind: "volume", value: amount * 1000 });
    else measures.push({ kind: "volume", value: amount });
  }
  return measures;
}

function measuresMatch(
  requested: CommercialMeasure[],
  candidate: CommercialMeasure[]
) {
  if (!requested.length) return true;
  return requested.every(expected =>
    candidate.some(
      actual =>
        actual.kind === expected.kind &&
        Math.abs(actual.value - expected.value) <= 0.05
    )
  );
}

export function isCommercialProductIdentityCompatible(input: {
  foodName: string;
  matchedProductName: string;
  brandName: string | null;
  servingLabel: string;
  gramsPerServing: number;
}) {
  const requestedTokens = extractCommercialTokens(input.foodName);
  const candidateIdentity = `${input.matchedProductName} ${input.brandName ?? ""}`;
  const candidateTokens = new Set(extractCommercialTokens(candidateIdentity));
  const candidateCompact = normalizeCommercialText(candidateIdentity).replace(
    /[^a-z0-9]/g,
    ""
  );
  const requestedCompact = requestedTokens.join("");

  const hasAllRequestedTokens = requestedTokens.every(
    token => candidateTokens.has(token) || candidateCompact.includes(token)
  );
  if (
    !hasAllRequestedTokens &&
    (!requestedCompact || !candidateCompact.includes(requestedCompact))
  ) {
    return false;
  }

  const requestedTokenSet = new Set(requestedTokens);
  const brandTokens = new Set(extractCommercialTokens(input.brandName ?? ""));
  const candidateProductTokens = extractCommercialTokens(
    input.matchedProductName
  );
  const unexpectedCandidateTokens = candidateProductTokens.filter(
    token =>
      !requestedTokenSet.has(token) &&
      !brandTokens.has(token) &&
      token !== requestedCompact &&
      !requestedCompact.includes(token)
  );
  if (unexpectedCandidateTokens.length > 0) return false;

  const requestedVariants = new Set(
    requestedTokens.filter(token => COMMERCIAL_VARIANT_TOKENS.has(token))
  );
  const candidateVariants = new Set(
    candidateProductTokens.filter(token => COMMERCIAL_VARIANT_TOKENS.has(token))
  );
  if (
    [...requestedVariants].some(token => !candidateVariants.has(token)) ||
    [...candidateVariants].some(token => !requestedVariants.has(token))
  ) {
    return false;
  }

  const requestedMeasures = extractCommercialMeasures(input.foodName);
  const candidateMeasures = extractCommercialMeasures(
    `${input.matchedProductName} ${input.servingLabel}`
  );
  if (!requestedMeasures.length && candidateMeasures.length) return false;
  if (
    !candidateMeasures.length &&
    requestedMeasures.some(measure => measure.kind === "mass")
  ) {
    candidateMeasures.push({ kind: "mass", value: input.gramsPerServing });
  }
  return measuresMatch(requestedMeasures, candidateMeasures);
}
