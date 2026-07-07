export function parseRanking(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*"[\w-]+"\s*:\s*\[[\s\S]*\]\s*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
  }
  return null;
}

const MODEL_REF_RE = /^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+)$/;

export function matchModelRef(rankedRef, allRefs) {
  if (allRefs.includes(rankedRef)) return rankedRef;

  const rankedLower = rankedRef.toLowerCase();
  for (const ref of allRefs) {
    if (ref.toLowerCase() === rankedLower) return ref;
  }

  const [rp, rm] = MODEL_REF_RE.test(rankedRef) ? rankedRef.match(MODEL_REF_RE).slice(1) : [];
  if (rp && rm) {
    const rpLower = rp.toLowerCase();
    const rmLower = rm.toLowerCase();

    for (const ref of allRefs) {
      const m = ref.match(MODEL_REF_RE);
      if (m && m[1].toLowerCase() === rpLower && m[2].toLowerCase() === rmLower) return ref;
    }

    for (const ref of allRefs) {
      const m = ref.match(MODEL_REF_RE);
      if (m && m[2].toLowerCase() === rmLower) return ref;
    }
  }

  return null;
}
