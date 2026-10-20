// Fact registry: every number a tool hands to the agent gets an ID, e.g. "-15.0% [F4]".
// The agent must cite these IDs, and the verifier checks every number in its draft
// against the registry. A number the tools never produced gets flagged.

export class FactRegistry {
  constructor() {
    this.facts = new Map(); // id -> { label, display }
    this.numbers = []; // every numeric value that appears in any fact
  }

  /** Register a fact and return the string the agent sees: "<display> [F<n>]". */
  add(label, display) {
    const id = "F" + (this.facts.size + 1);
    this.facts.set(id, { label, display });
    for (const t of numTokens(display)) this.numbers.push(t.v);
    return `${display} [${id}]`;
  }

  get(id) { return this.facts.get(id); }
  has(id) { return this.facts.has(id); }
}

/** Find numbers in text, with their position, decimals and unit hints. */
export function numTokens(str) {
  const out = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g;
  let m;
  while ((m = re.exec(str))) {
    const prev = m.index > 0 ? str[m.index - 1] : "";
    if (/[A-Za-z]/.test(prev)) continue; // part of a word, e.g. "Q1", "F12"
    const whole = m[1].replace(/,/g, "");
    const dec = m[2] || "";
    const after = str.slice(m.index + m[0].length, m.index + m[0].length + 3);
    out.push({
      v: parseFloat(whole + (dec ? "." + dec : "")),
      dec: dec.length,
      start: m.index,
      end: m.index + m[0].length,
      unit: /^\s?(%|pp)/.test(after),
      cur: prev === "€",
    });
  }
  return out;
}

/**
 * Check each number in a draft against the registry.
 * A number matches if some fact has the same value at the precision the draft wrote it
 * (so "15%" matches a fact "-15.0%"). Signs are not compared: the text may say "fell 15%".
 * Small plain integers (counts like "two categories" written as 2) and years are allowed.
 */
export function verifyText(text, registry) {
  return numTokens(text).map((t) => {
    let ok = false;
    if (!t.unit && !t.cur && t.dec === 0 && ((t.v >= 1990 && t.v <= 2100) || t.v <= 12)) ok = true;
    if (!ok) {
      const tol = 0.5 * Math.pow(10, -t.dec) + 1e-9;
      ok = registry.numbers.some((f) => Math.abs(f - t.v) <= tol);
    }
    return { ...t, ok };
  });
}
