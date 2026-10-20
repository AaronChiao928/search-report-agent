import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/dataset.js";
import { buildScopes } from "../src/checks.js";
import { contribution, decompose } from "../src/calc.js";
import { roles } from "../src/rules.js";
import { FactRegistry, verifyText } from "../src/facts.js";
import { BASE, RATIOS, UNALLOC } from "../src/metrics.js";

const load = (f) => parseCsv(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

test("gap demo: categories don't reconcile, so an Unallocated scope is added", () => {
  const sc = buildScopes(load("demo-gap.csv"));
  assert.equal(sc.R.flagged, true);
  assert.equal(sc.list.at(-1).name, UNALLOC);
});

test("clean demo: categories reconcile, no Unallocated scope", () => {
  const sc = buildScopes(load("demo-clean.csv"));
  assert.equal(sc.R.flagged, false);
  assert.ok(!sc.list.some((s) => s.name === UNALLOC));
});

test("contributions add up to 100% of the market change", () => {
  const sc = buildScopes(load("demo-gap.csv"));
  for (const b of BASE) {
    const total = contribution(sc, b.k).items.reduce((s, i) => s + i.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${b.k}: ${total}`);
  }
});

test("rate + mix effects add up exactly to the market change", () => {
  const sc = buildScopes(load("demo-gap.csv"));
  for (const r of RATIOS) {
    const d = decompose(sc, r.k);
    const sum = d.items.reduce((s, i) => s + i.total, 0);
    assert.ok(Math.abs(sum - d.d) < 1e-9, `${r.k}: ${sum} vs ${d.d}`);
  }
});

test("roles: a category is never driver and bottleneck for the same metric", () => {
  const { out } = roles(buildScopes(load("demo-gap.csv")));
  for (const rs of Object.values(out)) {
    for (const m of ["Clean QV", "eComm clicks"]) {
      assert.ok(!(rs.includes(`Efficiency driver (${m})`) && rs.includes(`Cost bottleneck (${m})`)));
    }
  }
});

test('"No data" is treated as missing, not zero', () => {
  const ds = load("demo-clean.csv");
  ds.rows[2].v.ec[0] = null; // Knives eComm clicks: No data
  const sc = buildScopes(ds);
  assert.deepEqual(sc.naMetrics.map((x) => x.k), ["ec"]);
  assert.equal(sc.R.flagged, false, "a missing value must not create a fake gap");
});

test("verifier: numbers from tools pass, invented numbers are flagged", () => {
  const reg = new FactRegistry();
  reg.add("Market clicks vs previous period", "-15.0%");
  reg.add("Market QV CPA", "€3.73");
  const checks = verifyText("Clicks fell 15% while QV CPA reached €3.73, up 99.9% in Q1 2026.", reg);
  assert.deepEqual(checks.map((c) => c.ok), [true, true, false, true]);
});
