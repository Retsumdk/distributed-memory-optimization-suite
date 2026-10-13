const TOKEN_PATTERN = /[a-z0-9]+/g;

export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lowered = text.toLowerCase();
  for (const match of lowered.matchAll(TOKEN_PATTERN)) {
    const word = match[0];
    if (word !== undefined && word.length > 1) tokens.add(word);
  }
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (large.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function textSimilarity(a: string, b: string): number {
  return jaccard(tokenize(a), tokenize(b));
}
