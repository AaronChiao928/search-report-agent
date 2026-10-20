#!/usr/bin/env node
// Command line:
//   node src/cli.js check   data/demo-gap.csv           data checks + rule results, no AI, no API key
//   node src/cli.js extract shots/*.png                  read screenshots into out/extracted.csv
//   node src/cli.js analyse data/demo-gap.csv [--brand X --market Y --period Z]
//                                                        run the agent; writes out/review.md and out/report.md

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseCsv, toCsv } from "./dataset.js";
import { BASE, fmt } from "./metrics.js";
import { buildScopes } from "./checks.js";
import { roles, scaleRead, funnelRead, ROLE_METRICS } from "./rules.js";
import { runAgent, DEFAULT_MODEL } from "./agent.js";
import { buildDraft, reviewMarkdown, reportText, itemFlags } from "./review.js";
import { readScreenshot, crossCheck } from "./extract.js";

const [, , cmd, ...rest] = process.argv;
const flags = {};
const files = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else files.push(rest[i]);
}

async function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY (see .env.example).");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

async function loadCsv(path) {
  return parseCsv(await readFile(path, "utf8"), { brand: flags.brand, market: flags.market, period: flags.period });
}

async function check() {
  const ds = await loadCsv(files[0]);
  const sc = buildScopes(ds);
  console.log("\nData check (categories vs market total)");
  for (const b of BASE) {
    const r = sc.R.per[b.k];
    if (r.na.length) { console.log(`  ${b.label.padEnd(14)} no data for ${r.na.join(", ")}: market level only`); continue; }
    console.log(`  ${b.label.padEnd(14)} gap now ${fmt(r.cur.gapPct, "share").padStart(5)}   gap previous period ${fmt(r.cmp.gapPct, "share").padStart(5)}`);
  }
  console.log(sc.R.flagged ? "  ⚠️  Categories don't add up to the market: an Unallocated scope will be analysed." : "  ✅ Categories add up to the market.");

  console.log("\nCategory roles (rules.js)");
  for (const [name, rs] of Object.entries(roles(sc).out)) console.log(`  ${name.padEnd(20)} ${rs.join(" & ") || "–"}`);

  console.log("\nScale and efficiency (market)");
  for (const m of ROLE_METRICS) console.log(`  ${m.name.padEnd(14)} ${scaleRead(sc.mkt.cur, sc.mkt.cmp, m).pattern}`);

  console.log("\nFunnel (market)");
  console.log(`  ${funnelRead(sc.mkt.cur, sc.mkt.cmp).reading}\n`);
}

async function extract() {
  const c = await client();
  const model = flags.model || DEFAULT_MODEL;
  const rows = [];
  let meta = {};
  for (const path of files) {
    const row = await readScreenshot({ client: c, model, path });
    const issues = crossCheck(row);
    console.log(`${path}: ${row.name} ${issues.length ? "⚠️ " + issues.join("; ") : "✅ cross-checked"}`);
    if (row.isMarket) { rows.unshift(row); meta = row.meta; } else rows.push(row);
  }
  if (!rows[0]?.isMarket) console.log("⚠️ No market-total screenshot (Keyword Category with nothing selected). Add the market row by hand.");
  await mkdir("out", { recursive: true });
  await writeFile("out/extracted.csv", toCsv({ rows }));
  console.log(`\nWrote out/extracted.csv${meta.brand ? ` (brand ${meta.brand}, market ${meta.market}, period ${meta.period})` : ""}. Check flagged values before analysing.`);
}

async function analyse() {
  const ds = await loadCsv(files[0]);
  const { output, registry, scopes, trace } = await runAgent({ ds, client: await client(), model: flags.model || DEFAULT_MODEL, onTrace: (l) => console.log("  " + l) });
  const draft = buildDraft(output, scopes, registry);
  await mkdir("out", { recursive: true });
  await writeFile("out/draft.json", JSON.stringify({ output, facts: Object.fromEntries(registry.facts) }, null, 2));
  await writeFile("out/trace.txt", trace.join("\n") + "\n");
  await writeFile("out/review.md", reviewMarkdown(draft, registry, ds.meta));
  await writeFile("out/report.md", reportText(draft, ds.meta));
  const flagged = [draft.headline, ...draft.cats, draft.funnel, ...draft.spots, ...draft.recs].filter((it) => itemFlags(it, registry).length).length;
  console.log(`\nWrote out/review.md (with sources and flags) and out/report.md (clean draft).`);
  console.log(`${flagged} part(s) flagged, ${draft.issues.length} issue(s). Review before anything goes to a client.`);
}

const commands = { check, extract, analyse };
if (!commands[cmd]) {
  console.log("Usage: node src/cli.js <check|extract|analyse> <files> [--brand X --market Y --period Z --model M]");
  process.exit(1);
}
commands[cmd]().catch((e) => { console.error("Error:", e.message); process.exit(1); });
