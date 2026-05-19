const NUMBER_FORMATTER_PT_BR = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

const INTEGER_FORMATTER_PT_BR = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export function formatNumberPtBr(value: number, options?: Intl.NumberFormatOptions) {
  const formatter = options ? new Intl.NumberFormat("pt-BR", options) : NUMBER_FORMATTER_PT_BR;
  return formatter.format(Number.isFinite(value) ? value : 0);
}

export function formatIntegerPtBr(value: number) {
  return INTEGER_FORMATTER_PT_BR.format(Number.isFinite(value) ? value : 0);
}

export function formatPercentPtBr(value: number, fractionDigits = 0) {
  return formatNumberPtBr(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatCalories(value: number) {
  return `${formatIntegerPtBr(Math.round(value))} kcal`;
}

export function formatGrams(value: number, fractionDigits = 0) {
  const normalized = fractionDigits > 0 ? value : Math.round(value);
  return `${formatNumberPtBr(normalized, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} g`;
}

export function formatCountPtBr(value: number, suffix = "") {
  return `${formatIntegerPtBr(value)}${suffix}`;
}

export function parseIntegerInputPtBr(value: string) {
  const digitsOnly = value.replace(/\D/g, "");
  return digitsOnly ? Number(digitsOnly) : 0;
}

export function formatIntegerInputPtBr(value: string | number) {
  const numericValue = typeof value === "number" ? value : parseIntegerInputPtBr(value);
  return numericValue ? formatIntegerPtBr(numericValue) : "";
}

export function parseDecimalInputPtBr(value: string) {
  const compact = value.trim().replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!compact) return 0;

  const sign = compact.startsWith("-") ? "-" : "";
  const unsigned = compact.replace(/-/g, "");
  const separators = Array.from(unsigned.matchAll(/[.,]/g)).map(match => ({
    separator: match[0],
    index: match.index ?? -1,
  }));

  if (!separators.length) {
    const parsedInteger = Number(`${sign}${unsigned.replace(/\D/g, "")}`);
    return Number.isFinite(parsedInteger) ? parsedInteger : 0;
  }

  const lastSeparator = separators[separators.length - 1];
  const rawIntegerPart = unsigned.slice(0, lastSeparator.index).replace(/[.,]/g, "");
  const rawDecimalPart = unsigned.slice(lastSeparator.index + 1).replace(/[.,]/g, "");

  const looksLikeThousandsSeparator = separators.length === 1 && rawDecimalPart.length === 3 && rawIntegerPart.length > 0;
  const normalized = looksLikeThousandsSeparator
    ? `${sign}${rawIntegerPart}${rawDecimalPart}`
    : `${sign}${rawIntegerPart || "0"}${rawDecimalPart ? `.${rawDecimalPart}` : ""}`;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDecimalInputPtBr(value: string | number, fractionDigits = 1) {
  const numericValue = typeof value === "number" ? value : parseDecimalInputPtBr(value);
  return numericValue
    ? formatNumberPtBr(numericValue, {
        minimumFractionDigits: 0,
        maximumFractionDigits: fractionDigits,
      })
    : "";
}
