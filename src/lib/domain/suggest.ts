/**
 * "Did you mean …?" for free-text identifiers typed by people (CSV headers,
 * enum spellings). Pure; no dependencies.
 */

/** Levenshtein edit distance (insert / delete / substitute, each cost 1). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Two rolling rows keep this O(min) in memory.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * The closest candidate, or null when nothing is plausibly what was meant.
 * A typo budget of about a third of the word (at least 2 edits) catches
 * "client nme" → "client_name" without turning "phone" into "notes".
 */
export function closestMatch(
  input: string,
  candidates: Iterable<string>,
): string | null {
  const word = input.trim().toLowerCase();
  if (!word) return null;
  const budget = Math.max(2, Math.floor(word.length / 3));

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = editDistance(word, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= budget ? best : null;
}
