function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isOptionalFiniteDate(value: unknown): value is Date | null {
  return value === null || isFiniteDate(value);
}

/** A malformed validity timestamp is never an open bound or S2 authority. */
export function isLinguisticLexiconEntryValidAt(
  validFrom: unknown,
  validTo: unknown,
  now: unknown
): boolean {
  if (
    !isFiniteDate(now) ||
    !isOptionalFiniteDate(validFrom) ||
    !isOptionalFiniteDate(validTo)
  ) {
    return false;
  }
  const instant = now.getTime();
  return (
    (validFrom === null || validFrom.getTime() <= instant) &&
    (validTo === null || validTo.getTime() > instant)
  );
}
