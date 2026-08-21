const STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "com"]);

export function removeDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeFoodName(value: string) {
  return removeDiacritics(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

export function normalizeFoodSearchKey(value: string) {
  return normalizeFoodName(value)
    .split(" ")
    .filter(part => part && !STOP_WORDS.has(part))
    .join(" ");
}

export function normalizeSourceCode(value: string) {
  return removeDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
