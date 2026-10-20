// Dataset model: one row for the market total (always rows[0]) and one per keyword category.
// Each base metric is stored as [currentValue, percentChangeVsPreviousPeriod].
// A current value of null means the dashboard showed "No data" (never treat it as 0).

import { BASE } from "./metrics.js";

/** Value of metric k for a row, in the current period ("cur") or the previous period ("cmp"). */
export function val(row, k, period) {
  const a = row.v[k];
  if (!a) return 0;
  if (a[0] == null || a[0] === "") return NaN; // "No data"
  const cur = Number(a[0]) || 0;
  if (period === "cur") return cur;
  const pct = Number(a[1]);
  if (!Number.isFinite(pct) || pct <= -100) return NaN;
  return cur / (1 + pct / 100); // rebuild the previous period from the % change
}

export const CSV_HEAD = ["scope", ...BASE.flatMap((b) => [b.k, b.k + "_vs_pp"])];

/** Parse a CSV in the template format. The first data row must be the market total. */
export function parseCsv(text, meta = {}) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",").map((s) => s.trim());
  const missing = CSV_HEAD.filter((h) => !head.includes(h));
  if (missing.length) throw new Error("CSV is missing columns: " + missing.join(", "));
  const idx = (n) => head.indexOf(n);
  const num = (x) => {
    const t = String(x ?? "").trim();
    if (t === "" || /no\s*data/i.test(t)) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };
  const rows = lines.slice(1).map((line) => {
    const c = line.split(",");
    const v = {};
    for (const b of BASE) v[b.k] = [num(c[idx(b.k)]), num(c[idx(b.k + "_vs_pp")]) ?? 0];
    return { name: (c[0] || "").trim(), v };
  });
  if (!rows.length) throw new Error("CSV has no data rows");
  rows[0].name = "Market total";
  return { meta, rows };
}

export function toCsv(ds) {
  const out = [CSV_HEAD.join(",")];
  for (const r of ds.rows) {
    const cells = BASE.flatMap((b) => (r.v[b.k] || [null, 0]).map((x) => (x == null ? "" : x)));
    out.push([r.name.replace(/,/g, " "), ...cells].join(","));
  }
  return out.join("\n") + "\n";
}
