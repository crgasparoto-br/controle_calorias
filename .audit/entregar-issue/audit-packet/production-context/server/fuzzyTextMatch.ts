/**
 * Fuzzy text matching utilities for food name lookup.
 *
 * Used as a fallback after exact and substring matching fails, to tolerate
 * single-character typos (e.g. "willians" → "williams", "frago" → "frango").
 */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Only allocate two rows instead of a full matrix
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/**
 * Returns true when every significant query word (3+ chars) has at least one
 * word in `haystack` within levenshtein distance ≤ 1.
 */
export function fuzzyMatchesWords(query: string, haystack: string): boolean {
  const queryWords = query.split(/\s+/).filter(w => w.length >= 3);
  if (!queryWords.length) return false;

  const haystackWords = haystack.split(/\s+/).filter(Boolean);
  if (!haystackWords.length) return false;

  return queryWords.every(qw =>
    haystackWords.some(hw => levenshtein(qw, hw) <= 1),
  );
}
