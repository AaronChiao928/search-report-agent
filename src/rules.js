// Judgement rules. Code decides, the agent explains.
// Every threshold lives here so a reviewer can read, question and change it.

import { UNALLOC } from "./metrics.js";

export const DIMINISHING_RETURNS_MARGIN = 0.2; // extra unit costs >20% above previous average CPA
export const ROLE_MIN_SHARE = 0.1; // a category needs >=10% of a metric to hold a role for it
export const FUNNEL_MIN_MOVE = 0.02; // CTR and QV rate must each move >2% to count as diverging
export const ROLE_METRICS = [
  { k: "qv", name: "Clean QV" },
  { k: "ec", name: "eComm clicks" },
];

const ratio = (o, num, den) => (o[den] ? o[num] / o[den] : NaN);

/** Overall scale and efficiency for one scope and one downstream metric. */
export function scaleRead(cur, cmp, metric) {
  const dc = cur.cost - cmp.cost;
  const dv = cur[metric.k] - cmp[metric.k];
  const n = metric.name;
  const avgCmp = ratio(cmp, "cost", metric.k);
  const avgCur = ratio(cur, "cost", metric.k);
  let pattern;
  let inc = NaN; // cost of each extra unit
  if (dc > 0 && dv > 0) {
    inc = dc / dv;
    pattern = inc > (1 + DIMINISHING_RETURNS_MARGIN) * avgCmp
      ? `diminishing returns: each extra ${n} cost more than the previous average`
      : `efficient scaling: extra spend bought extra ${n} at or below the previous average cost`;
  } else if (dc > 0 && dv <= 0) pattern = `spend rose while ${n} fell`;
  else if (dc <= 0 && dv > 0) pattern = `efficiency gain: ${n} rose while spend fell`;
  else {
    const fasterVolume = cmp[metric.k] && cmp.cost && Math.abs(dv / cmp[metric.k]) > Math.abs(dc / cmp.cost);
    pattern = fasterVolume ? `${n} fell faster than spend` : `spend fell faster than ${n}`;
  }
  return { pattern, inc, avgCmp, avgCur, dv, dc };
}

/**
 * Category roles, per metric, judged on change vs the previous period:
 *  - Scale anchor (spend): largest share of spend this period (a size question).
 *  - Efficiency driver (metric): largest fall in that metric's CPA.
 *  - Cost bottleneck (metric): largest CPC rise among categories whose CPA for that metric also rose.
 * Only categories with >= ROLE_MIN_SHARE of the metric qualify.
 * Because roles are longitudinal, one category can't be driver and bottleneck for the same metric.
 */
export function roles(sc) {
  const { list, mkt } = sc;
  const cats = list.filter((x) => x.name !== UNALLOC && x.cur.cost > 0);
  const out = {};
  cats.forEach((c) => (out[c.name] = []));
  const share = (c, k) => (mkt.cur[k] ? c.cur[k] / mkt.cur[k] : 0);
  const cpa = (o, k) => ratio(o, "cost", k);
  const cpaChg = (c, k) => cpa(c.cur, k) / cpa(c.cmp, k) - 1;
  const cpcChg = (c) => ratio(c.cur, "cost", "clicks") / ratio(c.cmp, "cost", "clicks") - 1;
  const helpers = { share, cpa, cpaChg, cpcChg };
  if (!cats.length) return { out, ...helpers };

  const anchor = cats.reduce((a, c) => (share(c, "cost") > share(a, "cost") ? c : a));
  out[anchor.name].push("Scale anchor (spend)");

  for (const m of ROLE_METRICS) {
    const withM = cats.filter((c) => c.cur[m.k] > 0 && c.cmp[m.k] > 0);
    if (!withM.length) continue;
    const eligible = withM.filter((c) => share(c, m.k) >= ROLE_MIN_SHARE);
    const pool = eligible.length ? eligible : withM;

    const better = pool.filter((c) => Number.isFinite(cpaChg(c, m.k)) && cpaChg(c, m.k) < 0);
    if (better.length) {
      const eff = better.reduce((a, c) => (cpaChg(c, m.k) < cpaChg(a, m.k) ? c : a));
      out[eff.name].push(`Efficiency driver (${m.name})`);
    }
    const worse = pool.filter((c) => Number.isFinite(cpaChg(c, m.k)) && cpaChg(c, m.k) > 0 && cpcChg(c) > 0);
    if (worse.length) {
      const bn = worse.reduce((a, c) => (cpcChg(c) > cpcChg(a) ? c : a));
      out[bn.name].push(`Cost bottleneck (${m.name})`);
    }
  }
  return { out, ...helpers };
}

/** Funnel reading for one scope: did pre-click (CTR) and post-click (QV rate) move apart? */
export function funnelRead(cur, cmp) {
  const ch = (n, d) => ratio(cur, n, d) / ratio(cmp, n, d) - 1;
  const ctr = ch("clicks", "impr"), qvr = ch("qv", "clicks"), ecr = ch("ec", "clicks");
  const diverged = Number.isFinite(ctr) && Number.isFinite(qvr)
    && Math.abs(ctr) > FUNNEL_MIN_MOVE && Math.abs(qvr) > FUNNEL_MIN_MOVE && Math.sign(ctr) !== Math.sign(qvr);
  return {
    ctr, qvr, ecr,
    ctrNow: ratio(cur, "clicks", "impr"), qvrNow: ratio(cur, "qv", "clicks"), ecrNow: ratio(cur, "ec", "clicks"),
    reading: diverged
      ? "pre-click engagement and post-click intent moved in opposite directions"
      : "pre-click and post-click moved the same way or changed little",
  };
}
