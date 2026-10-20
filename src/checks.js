// Step 2: data checks. Runs before any AI.
//  1) Do the categories add up to the market total, this period and last?
//  2) Which metrics are missing ("No data") for some category?
// The output is a list of "scopes" (the categories, plus an Unallocated residual when needed)
// that add up exactly to the market, so every market-level change can be fully explained.

import { BASE, UNALLOC } from "./metrics.js";
import { val } from "./dataset.js";

export const GAP_WARN = 0.02; // gaps above 2% are treated as real, not rounding
export const GAP_RESIDUAL = 0.005; // gaps above 0.5% get their own Unallocated scope

export function reconcile(ds) {
  const market = ds.rows[0];
  const cats = ds.rows.slice(1);
  const out = { flagged: false, per: {} };
  for (const b of BASE) {
    const r = {};
    for (const p of ["cur", "cmp"]) {
      const M = val(market, b.k, p);
      const sum = cats.reduce((s, c) => s + val(c, b.k, p), 0);
      r[p] = { M, sum, gap: M - sum, gapPct: M ? (M - sum) / M : 0 };
    }
    // Categories showing "No data" for this metric: it can't be reconciled, only reported at market level.
    r.na = cats.filter((c) => c.v[b.k] && (c.v[b.k][0] == null || c.v[b.k][0] === "")).map((c) => c.name);
    if (!r.na.length && ["cur", "cmp"].some((p) => Math.abs(r[p].gapPct) > GAP_WARN)) out.flagged = true;
    out.per[b.k] = r;
  }
  return out;
}

export function buildScopes(ds) {
  const R = reconcile(ds);
  const list = ds.rows.slice(1).map((r) => {
    const o = { name: r.name, cur: {}, cmp: {} };
    for (const b of BASE) {
      o.cur[b.k] = val(r, b.k, "cur");
      o.cmp[b.k] = val(r, b.k, "cmp");
    }
    return o;
  });

  const hasResidual = BASE.some(
    (b) => !R.per[b.k].na.length && ["cur", "cmp"].some((p) => Math.abs(R.per[b.k][p].gapPct) > GAP_RESIDUAL)
  );
  if (hasResidual) {
    const u = { name: UNALLOC, cur: {}, cmp: {} };
    for (const b of BASE) {
      const r = R.per[b.k];
      if (r.na.length) { u.cur[b.k] = NaN; u.cmp[b.k] = NaN; continue; }
      u.cur[b.k] = Math.abs(r.cur.gapPct) > GAP_RESIDUAL ? r.cur.gap : 0;
      u.cmp[b.k] = r.cmp.gap;
    }
    list.push(u);
  }

  // Market totals = sum of scopes, so contributions add up to exactly 100%.
  const mkt = { cur: {}, cmp: {} };
  for (const b of BASE) {
    if (R.per[b.k].na.length) {
      mkt.cur[b.k] = val(ds.rows[0], b.k, "cur");
      mkt.cmp[b.k] = val(ds.rows[0], b.k, "cmp");
      continue;
    }
    mkt.cur[b.k] = list.reduce((s, x) => s + x.cur[b.k], 0);
    mkt.cmp[b.k] = list.reduce((s, x) => s + x.cmp[b.k], 0);
  }
  const naMetrics = BASE.filter((b) => R.per[b.k].na.length).map((b) => ({ k: b.k, label: b.label, categories: R.per[b.k].na }));
  return { list, mkt, R, hasResidual, naMetrics };
}
