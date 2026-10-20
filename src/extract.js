// Step 1 (optional): read dashboard screenshots with Claude's vision.
// Reading is the one place AI touches raw numbers, so every read is cross-checked by code:
// the dashboard also shows ratios (CTR, CPC, CPAs...). We recompute them from the base numbers
// that were read; if they don't match what the screenshot shows, something was misread.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { RATIOS } from "./metrics.js";
import { val } from "./dataset.js";
import { EXTRACT_PROMPT } from "./prompts.js";
import { parseJson } from "./agent.js";

const MEDIA = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAP_BASE = { impr: "impressions", clicks: "clicks", cost: "cost", qv: "clean_qv", ec: "ecomm_clicks" };
const MAP_RATIO = { ctr: "ctr", cpc: "cpc", qvr: "qv_rate", qvcpa: "qv_cpa", ecr: "ecomm_click_rate", eccpa: "ecomm_click_cpa" };
const isNoData = (x) => (typeof x === "string" && /no\s*data/i.test(x)) || (Array.isArray(x) && typeof x[0] === "string" && /no\s*data/i.test(x[0]));
const num = (x, d) => { const n = parseFloat(x); return Number.isFinite(n) ? n : d; };

/** Read one screenshot into a dataset row: { name, v, shown, missing, meta }. */
export async function readScreenshot({ client, model, path }) {
  const data = (await readFile(path)).toString("base64");
  const media_type = MEDIA[extname(path).toLowerCase()];
  if (!media_type) throw new Error(`Unsupported image type: ${path}`);
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type, data } },
      { type: "text", text: EXTRACT_PROMPT },
    ] }],
  });
  const out = parseJson(res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"));
  const m = out.metrics || {};

  const v = {};
  const missing = [];
  for (const [k, src0] of Object.entries(MAP_BASE)) {
    const src = k === "qv" && m.clean_qv == null ? "qualified_visits" : src0; // older dashboards: no Clean QV
    const raw = m[src];
    if (isNoData(raw)) { v[k] = [null, 0]; continue; }
    const a = Array.isArray(raw) ? raw : [];
    const n = num(a[0], null);
    if (n == null) missing.push(k);
    v[k] = [n ?? 0, num(a[1], 0)];
  }
  const shown = {};
  for (const [k, src] of Object.entries(MAP_RATIO)) if (Array.isArray(m[src])) shown[k] = m[src].map((x) => num(x, null));

  // "Keyword Category" with nothing selected = market total.
  let cat = out.keyword_category ? String(out.keyword_category).replace(/^\s*keyword\s*category\s*[:：]?\s*/i, "").trim() : null;
  if (!cat || /^(keyword\s*)?categor(y|ies)$/i.test(cat) || /^\(?\d*\)?$/.test(cat)) cat = null;

  return { name: cat || "Market total", isMarket: !cat, v, shown, missing, meta: { brand: out.brand, market: out.market, period: out.period } };
}

/** Compare ratios shown on the dashboard with ratios rebuilt from the base numbers read. */
export function crossCheck(row) {
  const issues = [];
  for (const r of RATIOS) {
    const s = row.shown?.[r.k];
    if (!s || s[0] == null) continue;
    const isPct = r.fmt === "pct";
    const nc = val(row, r.num, "cur"), dc = val(row, r.den, "cur");
    if (!dc) continue;
    const calc = (nc / dc) * (isPct ? 100 : 1);
    const shownV = Number(s[0]);
    // Tolerance follows the precision shown on the dashboard: "20%" means anything from 19.5 to 20.5.
    const dec = (String(shownV).split(".")[1] || "").length;
    const tol = 0.5 * Math.pow(10, -dec) * 1.05 + 0.01 * Math.abs(shownV);
    if (Math.abs(calc - shownV) > tol) issues.push(`${r.label}: numbers read imply ${calc.toFixed(2)}, screenshot shows ${shownV}`);
    if (s[1] != null) {
      const a = row.v[r.num][1], b = row.v[r.den][1];
      const implied = ((1 + a / 100) / (1 + b / 100) - 1) * 100;
      if (Math.abs(implied - s[1]) > Math.max(1.0, 0.02 * Math.abs(s[1]))) issues.push(`${r.label} vs PP: changes read imply ${implied.toFixed(1)}%, screenshot shows ${s[1]}%`);
    }
  }
  for (const k of row.missing || []) issues.push(`${k}: value couldn't be read`);
  return issues;
}
