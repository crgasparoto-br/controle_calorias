const REPLACEMENT_COMMAND_OCCURRENCE =
  /(?:n[aã]o)\s+(?:é|e|era)(?=\s)|\b(?:trocar|troque|troca|mudar|alterar|corrigir|substituir|substitua)\b/gi;

export function hasMultipleWhatsappFoodReplacementCommands(text: string) {
  return (text.match(REPLACEMENT_COMMAND_OCCURRENCE) ?? []).length > 1;
}
