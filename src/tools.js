// The agent's tools. Each tool runs deterministic code and returns small JSON
// in which every number carries a fact ID from the registry.
// The agent decides WHICH tools to call and in what order; it never does the maths.

import { BASE, RATIOS, UNALLOC, fmt, deltaFmt } from "./metrics.js";
import { buildScopes } from "./checks.js";
import { contribution, decompose } from "./calc.js";
import { roles, scaleRead, funnelRead, ROLE_METRICS, ROLE_MIN_SHARE, DIMINISHING_RETURNS_MARGIN } from "./rules.js";

const L = "previous period";
const ratio = (o, num, den) => (o[den] ? o[num] / o[den] : NaN);

export function buildTools(ds, registry) {
  const sc = buildScopes(ds);
  const F = (label, display) => registry.add(label, display);

  function overview() {
    const out = { comparison: L, market: {}, data_check: {} };
    for (const b of BASE) {
      const c = contribution(sc, b.k);
      out.market[b.label] = {
        current: F(`Market ${b.label}, current`, fmt(c.cur, b.fmt)),
        change: F(`Market ${b.label} vs ${L}`, fmt(c.chg, "chg")),
      };
    }
    for (const r of RATIOS) {
      const d = decompose(sc, r.k);
      out.market[r.label] = {
        current: F(`Market ${r.label}, current`, fmt(d.cur, r.fmt)),
        previous: F(`Market ${r.label}, ${L}`, fmt(d.cmp, r.fmt)),
        change: F(`Market ${r.label} vs ${L}`, fmt(d.chg, "chg")),
      };
    }
    out.data_check.categories_reconcile = !sc.R.flagged;
    if (sc.hasResidual) {
      out.data_check.note = `Listed categories do not add up to the market total. The difference is the scope '${UNALLOC}'.`;
      out.data_check.unallocated_share_of_market_previous_period = {};
      for (const b of BASE) {
        if (sc.R.per[b.k].na.length) continue;
        out.data_check.unallocated_share_of_market_previous_period[b.label] =
          F(`Unallocated share of market ${b.label}, ${L}`, fmt(sc.R.per[b.k].cmp.gapPct, "share"));
      }
    }
    if (sc.naMetrics.length) {
      out.data_check.metrics_without_category_data = sc.naMetrics.map(
        (x) => `${x.label}: no data for ${x.categories.join(", ")}. Discuss it at market level only, and mention the gap in internal_notes.`
      );
    }
    out.scopes = sc.list.map((s) => s.name);
    return out;
  }

  function categoryContributions({ metric }) {
    const b = BASE.find((x) => x.k === metric);
    if (!b) throw new Error("Unknown metric. Use one of: " + BASE.map((x) => x.k).join(", "));
    const na = sc.R.per[b.k].na;
    if (na.length) throw new Error(`${b.label} has no data for ${na.join(", ")}, so it can only be discussed at market level.`);
    const c = contribution(sc, b.k);
    const dfmt = b.fmt === "eur0" ? "deur0" : "dint";
    return {
      metric: b.label, comparison: L,
      market_change: F(`Market ${b.label} change vs ${L}`, fmt(c.d, dfmt)),
      market_change_pct: F(`Market ${b.label} vs ${L}`, fmt(c.chg, "chg")),
      by_scope: c.items.map((i) => ({
        scope: i.name,
        current: F(`${i.name} ${b.label}, current`, fmt(i.cur, b.fmt)),
        change: F(`${i.name} ${b.label} change vs ${L}`, fmt(i.d, dfmt)),
        change_pct: F(`${i.name} ${b.label} vs ${L}`, fmt(i.chg, "chg")),
        share_of_market_change: F(`${i.name} share of market ${b.label} change`, fmt(i.share, "share")),
      })),
    };
  }

  function decomposeRate({ metric }) {
    const r = RATIOS.find((x) => x.k === metric);
    if (!r) throw new Error("Unknown rate metric. Use one of: " + RATIOS.map((x) => x.k).join(", "));
    const na = sc.naMetrics.filter((x) => x.k === r.num || x.k === r.den);
    if (na.length) throw new Error(`${r.label} can only be discussed at market level (missing category data).`);
    const d = decompose(sc, r.k);
    const df = deltaFmt(r.fmt);
    const den = BASE.find((b) => b.k === r.den).label;
    return {
      metric: r.label, comparison: L, weighted_by: den,
      market: {
        current: F(`Market ${r.label}, current`, fmt(d.cur, r.fmt)),
        previous: F(`Market ${r.label}, ${L}`, fmt(d.cmp, r.fmt)),
        change: F(`Market ${r.label} change vs ${L}`, fmt(d.d, df)),
      },
      by_scope: d.items.map((i) => ({
        scope: i.name,
        own_rate_current: F(`${i.name} ${r.label}, current`, fmt(i.rc, r.fmt)),
        own_rate_previous: F(`${i.name} ${r.label}, ${L}`, fmt(i.rp, r.fmt)),
        volume_share_current: F(`${i.name} share of market ${den}, current`, fmt(i.wc, "share")),
        volume_share_previous: F(`${i.name} share of market ${den}, ${L}`, fmt(i.wp, "share")),
        rate_effect: F(`${i.name} rate effect on market ${r.label}`, fmt(i.rate, df)),
        mix_effect: F(`${i.name} mix effect on market ${r.label}`, fmt(i.mix, df)),
        share_of_market_change: F(`${i.name} share of market ${r.label} change`, fmt(i.share, "share")),
      })),
      how_to_read: "rate_effect = change caused by the scope's own rate moving; mix_effect = change caused by its share of volume moving. They add up across scopes to the market change.",
    };
  }

  function scaleEfficiency() {
    const one = (name, cur, cmp) => {
      const o = { scope: name, cost_change: F(`${name} cost vs ${L}`, fmt(cmp.cost ? (cur.cost - cmp.cost) / cmp.cost : NaN, "chg")) };
      for (const m of ROLE_METRICS) {
        const r = scaleRead(cur, cmp, m);
        o[m.name] = {
          change: F(`${name} ${m.name} vs ${L}`, fmt(cmp[m.k] ? r.dv / cmp[m.k] : NaN, "chg")),
          cpa_previous: F(`${name} cost per ${m.name}, ${L}`, fmt(r.avgCmp, "eur2")),
          cpa_current: F(`${name} cost per ${m.name}, current`, fmt(r.avgCur, "eur2")),
          ...(Number.isFinite(r.inc) ? { incremental_cpa: F(`${name} cost of each extra ${m.name}`, fmt(r.inc, "eur2")) } : {}),
          reading: r.pattern,
        };
      }
      return o;
    };
    return {
      comparison: L,
      rule: `Diminishing returns = each extra unit costs more than ${DIMINISHING_RETURNS_MARGIN * 100}% above the previous average CPA.`,
      market: one("Market", sc.mkt.cur, sc.mkt.cmp),
      by_scope: sc.list.map((x) => one(x.name, x.cur, x.cmp)),
    };
  }

  function categoryRoles() {
    const r = roles(sc);
    return {
      comparison: L,
      rules: {
        "Scale anchor (spend)": "largest share of spend in the current period",
        "Efficiency driver (<metric>)": `largest fall in CPA for that metric vs the previous period, among categories with at least ${ROLE_MIN_SHARE * 100}% of that metric; none if no CPA fell`,
        "Cost bottleneck (<metric>)": `largest CPC increase among categories with at least ${ROLE_MIN_SHARE * 100}% of that metric whose CPA for that metric also rose; none if none qualifies`,
        note: "Roles are per metric, so one category can be an efficiency driver for one metric and a cost bottleneck for another.",
      },
      by_category: sc.list.filter((x) => x.name !== UNALLOC && r.out[x.name]).map((c) => {
        const o = {
          category: c.name,
          roles: r.out[c.name],
          spend_share: F(`${c.name} share of spend, current`, fmt(r.share(c, "cost"), "share")),
          cpc_change: F(`${c.name} CPC vs ${L}`, fmt(r.cpcChg(c), "chg")),
        };
        for (const m of ROLE_METRICS) {
          o[m.name] = {
            share: F(`${c.name} share of ${m.name}, current`, fmt(r.share(c, m.k), "share")),
            cpa: F(`${c.name} cost per ${m.name}, current`, fmt(r.cpa(c.cur, m.k), "eur2")),
            cpa_change: F(`${c.name} cost per ${m.name} vs ${L}`, fmt(r.cpaChg(c, m.k), "chg")),
          };
        }
        return o;
      }),
    };
  }

  function funnel() {
    const one = (name, cur, cmp) => {
      const f = funnelRead(cur, cmp);
      return {
        scope: name,
        ctr: F(`${name} CTR, current`, fmt(f.ctrNow, "pct")),
        ctr_change: F(`${name} CTR vs ${L}`, fmt(f.ctr, "chg")),
        qv_rate: F(`${name} QV rate, current`, fmt(f.qvrNow, "pct")),
        qv_rate_change: F(`${name} QV rate vs ${L}`, fmt(f.qvr, "chg")),
        ecomm_click_rate: F(`${name} eComm click rate, current`, fmt(f.ecrNow, "pct")),
        ecomm_click_rate_change: F(`${name} eComm click rate vs ${L}`, fmt(f.ecr, "chg")),
        reading: f.reading,
      };
    };
    return { comparison: L, market: one("Market", sc.mkt.cur, sc.mkt.cmp), by_scope: sc.list.map((x) => one(x.name, x.cur, x.cmp)) };
  }

  function categoryProfile({ category }) {
    const s = sc.list.find((x) => x.name.toLowerCase() === String(category).toLowerCase());
    if (!s) throw new Error("Unknown category. Use one of: " + sc.list.map((x) => x.name).join(", "));
    const o = { category: s.name, comparison: L, metrics: {} };
    for (const b of BASE) {
      o.metrics[b.label] = {
        current: F(`${s.name} ${b.label}, current`, fmt(s.cur[b.k], b.fmt)),
        change: F(`${s.name} ${b.label} vs ${L}`, fmt(s.cmp[b.k] ? (s.cur[b.k] - s.cmp[b.k]) / s.cmp[b.k] : NaN, "chg")),
      };
    }
    for (const r of RATIOS) {
      const rc = ratio(s.cur, r.num, r.den), rp = ratio(s.cmp, r.num, r.den);
      o.metrics[r.label] = {
        current: F(`${s.name} ${r.label}, current`, fmt(rc, r.fmt)),
        change: F(`${s.name} ${r.label} vs ${L}`, fmt(rc / rp - 1, "chg")),
      };
    }
    return o;
  }

  const metricSchema = (keys) => ({ type: "object", properties: { metric: { type: "string", enum: keys } }, required: ["metric"] });
  const none = { type: "object", properties: {} };

  const tools = [
    { name: "get_overview", description: "Market-level totals, rates and % changes vs the previous period, the data reconciliation check, and the list of scopes. Call this first.", input_schema: none, run: overview },
    { name: "get_scale_efficiency", description: "For the market and each scope: how spend changed against Clean QV and eComm clicks, previous and current CPA, the cost of each extra unit, and a coded reading (diminishing returns, efficient scaling, etc.).", input_schema: none, run: scaleEfficiency },
    { name: "get_category_roles", description: "Category roles assigned by fixed rules, per metric: Scale anchor (spend), Efficiency driver (Clean QV / eComm clicks), Cost bottleneck (Clean QV / eComm clicks), with the numbers behind them. Use these roles exactly; never assign roles yourself.", input_schema: none, run: categoryRoles },
    { name: "get_funnel", description: "Search funnel: CTR (pre-click) against QV rate and eComm click rate (post-click) for the market and each scope, with a coded reading of whether they diverged.", input_schema: none, run: funnel },
    { name: "get_category_contributions", description: "For one volume or cost metric, each scope's current value, change and share of the market-level change. metric is one of: " + BASE.map((b) => b.k).join(", ") + ".", input_schema: metricSchema(BASE.map((b) => b.k)), run: categoryContributions },
    { name: "decompose_rate", description: "For one rate or cost-per metric, splits the market change into each scope's rate effect (its own rate moved) and mix effect (its share of volume moved). metric is one of: " + RATIOS.map((r) => r.k).join(", ") + ".", input_schema: metricSchema(RATIOS.map((r) => r.k)), run: decomposeRate },
    { name: "get_category_profile", description: "All metrics and % changes for one listed category.", input_schema: { type: "object", properties: { category: { type: "string" } }, required: ["category"] }, run: categoryProfile },
  ];

  return { tools, scopes: sc };
}
