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
