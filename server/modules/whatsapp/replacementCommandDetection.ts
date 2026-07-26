export const WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN =
  "(?:(?:n[aã]o)\\s+(?:é|e|era)(?=\\s|$|[,;:!?])|(?:trocar|troque|troca|mudar|alterar|corrigir|substituir|substitua)\\b(?=\\s|$|[,;:!?]))";

export function isWhatsappFoodReplacementCommandStart(text: string) {
  return new RegExp(
    `^\\s*${WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN}`,
    "i"
  ).test(text);
}

export function countWhatsappFoodReplacementCommands(text: string) {
  return (
    text.match(
      new RegExp(WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN, "gi")
    ) ?? []
  ).length;
}

export function hasMultipleWhatsappFoodReplacementCommands(text: string) {
  return countWhatsappFoodReplacementCommands(text) > 1;
}
