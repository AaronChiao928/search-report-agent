// Step 5: turn the agent's JSON into a draft a person can review, and flag anything suspect.
// Step 6 (export) only ever uses text a person has kept; source IDs never reach the report.

import { UNALLOC } from "./metrics.js";
import { verifyText } from "./facts.js";
import { roles } from "./rules.js";

export const REC_TYPES = ["Budget reallocation", "Search term & bidding control", "Creative & ad relevance"];
const JARGON = /\b(rate effect|mix effect|scope|unallocated)\b|\bF\d+\b/i;
const arr = (x) => (Array.isArray(x) ? x : []);
export const clientName = (n) => (n === UNALLOC ? "Keywords outside the reported categories" : n);

/** Remove any "[F12]" style IDs the model may have left in client text. */
export function cleanText(t) {
  return String(t ?? "").replace(/\s*[[(]\s*F\d+(?:\s*,\s*F\d+)*\s*[\])]/g, "").replace(/\s{2,}/g, " ").trim();
}

function item(o, registry, extra = {}) {
  const text = cleanText(o?.text);
  return { text, ids: arr(o?.fact_ids).map(String), check: verifyText(text, registry), ...extra };
}

export function buildDraft(output, scopes, registry) {
  const coded = roles(scopes).out;
  const issues = [];
  const d = { headline: item(output?.headline, registry, { part: "Overall" }), cats: [], funnel: null, spots: [], recs: [], notes: [], issues };

  const seen = new Set();
  for (const c of arr(output?.categories)) {
    if (!c?.text) continue;
    const real = scopes.list.find((x) => x.name.toLowerCase() === String(c.category || "").toLowerCase());
    const name = real ? real.name : String(c.category || "");
    seen.add(name.toLowerCase());
    const expected = real ? coded[real.name] || [] : [];
    d.cats.push(item(c, registry, { scope: name, role: expected.join(" & "), saidRole: String(c.role || ""), expected }));
  }
  d.funnel = item(output?.funnel?.overall, registry, { part: "Funnel" });
  for (const s of arr(output?.funnel?.spotlights)) if (s?.text) d.spots.push(item(s, registry, { scope: String(s.category || "") }));
  for (const r of arr(output?.recommendations)) if (r?.text) d.recs.push(item(r, registry, { type: String(r.type || "Recommendation"), rec: true }));
  for (const n of arr(output?.internal_notes)) if (n?.text) d.notes.push(item(n, registry));

  const missing = scopes.list.map((x) => x.name).filter((n) => !seen.has(n.toLowerCase()));
  if (missing.length) issues.push(`No bullet was returned for: ${missing.join(", ")}.`);
  if (!d.headline.text) issues.push("No overall scale and efficiency summary was returned.");
  const lackRec = REC_TYPES.filter((t) => !d.recs.some((r) => r.type === t));
  if (lackRec.length) issues.push(`Missing recommendation type: ${lackRec.join(", ")}.`);
  return d;
}

/** Everything a reviewer should look at for one part of the draft. */
export function itemFlags(it, registry) {
  const f = [];
  const bad = it.check.filter((t) => !t.ok).length;
  if (bad) f.push(`${bad} number${bad > 1 ? "s" : ""} not found in the calculations`);
  if (it.ids.some((id) => !registry.has(id))) f.push("cites a source that doesn't exist");
  if (JARGON.test(it.text)) f.push("internal wording in client text");
  if (it.expected) {
    const said = it.saidRole.toLowerCase().split(/\s*[&;,]\s*/).filter(Boolean).sort().join("|");
    const exp = it.expected.map((x) => x.toLowerCase()).sort().join("|");
    if (said !== exp) f.push(`agent said role "${it.saidRole || "none"}", rules give "${it.role || "none"}"`);
  }
  if (it.rec && !it.ids.length) f.push("no number backs this recommendation");
  return f;
}

export function labelOf(it) {
  if (it.rec) return it.type;
  if (it.expected) return clientName(it.scope) + (it.role ? ` (${it.role})` : "");
  if (it.scope) return clientName(it.scope);
  return "";
}

export const reportTitle = (meta) =>
  `${meta?.brand || "Brand"} ${meta?.market || ""} – Search performance, ${meta?.period || ""} vs previous period`.replace(/\s+/g, " ").trim();

/** Clean, paste-ready report (Markdown). Rejected recommendations are left out. */
export function reportText(d, meta, { keepRecs = d.recs.map(() => true) } = {}) {
  const live = (a) => a.filter((x) => !x.removed);
  let t = `## ${reportTitle(meta)}\n\n### Overall scale and efficiency\n${d.headline.text}\n\n`;
  t += `### Category performance\n${live(d.cats).map((c) => `- ${labelOf(c)}: ${c.text}`).join("\n")}\n\n`;
  t += `### Search funnel and traffic quality\n${d.funnel.text}\n${live(d.spots).map((c) => `- ${labelOf(c)}: ${c.text}`).join("\n")}\n`;
  const recs = d.recs.filter((_, i) => keepRecs[i]);
  if (recs.length) t += `\n### Recommendations\n${recs.map((r) => `- ${r.type}: ${r.text}`).join("\n")}\n`;
  return t;
}

/** Review file for the command line: every part with its flags and the sources behind it. */
export function reviewMarkdown(d, registry, meta) {
  const block = (title, it) => {
    const flags = itemFlags(it, registry);
    const bad = it.check.filter((t) => !t.ok).map((t) => it.text.slice(t.start, t.end));
    let s = `#### ${title}\n${it.text || "_(empty)_"}\n\n`;
    s += flags.length ? `> ⚠️ ${flags.join("; ")}${bad.length ? ` (unmatched: ${bad.join(", ")})` : ""}\n\n` : "> ✅ All numbers traced\n\n";
    s += it.ids.length ? it.ids.map((id) => `- ${id}: ${registry.get(id)?.display ?? "MISSING"} – ${registry.get(id)?.label ?? ""}`).join("\n") + "\n\n" : "";
    return s;
  };
  let s = `# Review: ${reportTitle(meta)}\n\n`;
  if (d.issues.length) s += `## Issues\n${d.issues.map((i) => `- ${i}`).join("\n")}\n\n`;
  s += `## Analysis\n` + block("Overall scale and efficiency", d.headline);
  d.cats.forEach((c) => (s += block(labelOf(c), c)));
  s += block("Search funnel and traffic quality", d.funnel);
  d.spots.forEach((c) => (s += block(`Spotlight: ${labelOf(c)}`, c)));
  s += `## Recommendations (decide on each)\n`;
  d.recs.forEach((r) => (s += block(r.type, r)));
  if (d.notes.length) s += `## Internal notes (not for the client)\n${d.notes.map((n) => `- ${n.text}`).join("\n")}\n`;
  return s;
}
