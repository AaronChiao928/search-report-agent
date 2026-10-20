// Step 3: calculations. Pure maths, no AI.

import { RATIOS } from "./metrics.js";

/** Volume metric: each scope's change and its share of the market change. */
export function contribution(sc, k) {
  const { list, mkt } = sc;
  const dM = mkt.cur[k] - mkt.cmp[k];
  return {
    cur: mkt.cur[k],
    cmp: mkt.cmp[k],
    d: dM,
    chg: mkt.cmp[k] ? dM / mkt.cmp[k] : NaN,
    items: list.map((s) => {
      const d = s.cur[k] - s.cmp[k];
      return {
        name: s.name, cur: s.cur[k], cmp: s.cmp[k], d,
        chg: s.cmp[k] ? d / s.cmp[k] : NaN,
        share: Math.abs(dM) > 1e-9 ? d / dM : NaN,
      };
    }),
  };
}

/**
 * Rate metric R = num / den. The market rate is a weighted average of scope rates,
 * where each weight is the scope's share of den. The market change splits per scope into:
 *   rate effect = average weight x change in the scope's own rate
 *   mix effect  = average rate   x change in the scope's weight
 * This midpoint split adds up exactly to the market change.
 */
export function decompose(sc, rk) {
  const R = RATIOS.find((x) => x.k === rk);
  const { list, mkt } = sc;
  const Dc = mkt.cur[R.den], Dp = mkt.cmp[R.den];
  const Mc = mkt.cur[R.num] / Dc, Mp = mkt.cmp[R.num] / Dp;
  const dM = Mc - Mp;
  const items = list.map((s) => {
    const dc = s.cur[R.den], dp = s.cmp[R.den];
    let rc = dc ? s.cur[R.num] / dc : NaN;
    let rp = dp ? s.cmp[R.num] / dp : NaN;
    // A scope present in only one period has no rate effect: its whole effect is mix.
    if (!Number.isFinite(rc)) rc = rp;
    if (!Number.isFinite(rp)) rp = rc;
    const wc = dc / Dc, wp = dp / Dp;
    if (!Number.isFinite(rc)) return { name: s.name, rc: NaN, rp: NaN, wc, wp, rate: 0, mix: 0, total: 0, share: NaN };
    const rate = ((wc + wp) / 2) * (rc - rp);
    const mix = ((rc + rp) / 2) * (wc - wp);
    return {
      name: s.name, rc: dc ? rc : NaN, rp: dp ? rp : NaN, wc, wp, rate, mix, total: rate + mix,
      share: Math.abs(dM) > 1e-12 ? (rate + mix) / dM : NaN,
    };
  });
  return { R, cur: Mc, cmp: Mp, d: dM, chg: Mp ? dM / Mp : NaN, items };
}
