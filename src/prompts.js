// Prompts. Business rules that came from the analyst's own reporting practice
// (structure, wording, what not to do) live here as plain text so they're easy to review.

import { UNALLOC } from "./metrics.js";

export function analysisPrompt(ds, sc) {
  const cats = ds.rows.slice(1).map((r) => r.name);
  const { brand = "", market = "", period = "" } = ds.meta || {};
  const gap = sc.hasResidual
    ? ` Data check result: the listed categories do NOT fully add up to the market total${sc.R.flagged ? " (material gap)" : " (small gap)"}. The difference is analysed as an extra scope called "${UNALLOC}". Account for its effect on market-level changes, and describe the gap in internal_notes.`
    : "";
  return `You are a senior paid search strategist writing the analysis section of a client report for a Google Search campaign.
Context: brand "${brand}", market "${market}", period ${period}. Comparison: vs previous period.
The market total is made up of these keyword categories: ${cats.join(", ")}.${gap}

Write the analysis in four parts:
1. headline: overall scale and efficiency, 2 or 3 sentences. Did the change in spend bring incremental demand or diminishing returns further down the funnel (Clean QV and eComm clicks)? Base it on get_scale_efficiency.
2. categories: one bullet per category${sc.hasResidual ? ` plus one for "${UNALLOC}"` : ""}, ordered by impact on the market, 1 or 2 sentences each. Use the roles from get_category_roles exactly as given. Roles are per metric, so a category can be an efficiency driver for one metric and a cost bottleneck for another; when that happens, explain both sides. Put all of a category's roles in "role" joined with " & " (empty if none); never assign or rename a role yourself. For a cost bottleneck, explain how the CPC change fed through to the CPA for that metric. Say how the category moved the market-level results.
3. funnel: an overall diagnosis of whether pre-click engagement (CTR) and post-click intent (QV rate, eComm click rate) moved together or diverged, based on get_funnel, then 1 or 2 category spotlights that back it up.
4. recommendations: exactly 3, one of each type: "Budget reallocation", "Search term & bidding control", "Creative & ad relevance". 1 or 2 sentences each, naming the category concerned and tied to at least one number from the tools. Recommend only what the numbers support. You cannot see budgets, seasonality or tests in flight, so do not assume them.
Rules:
- Every number you write must be copied exactly as it appears in the tool results (for example "+12.3%", "€1.06", "+0.25 pp"). Never calculate, combine, re-round or estimate a number yourself.
- List the fact IDs of every number you used in "fact_ids", never in the text.
- Client-facing British English. Never put fact IDs, tool names, the word "scope", or the terms "rate effect" and "mix effect" in the text. Explain mechanisms in plain words, for example "driven by its own CPA rising" or "because a larger share of Clean QV came from Knives, which has a higher CPA".${sc.hasResidual ? `\n- In the text, call "${UNALLOC}" "keywords outside the reported categories".` : ""}
- Caveats meant only for the reviewer (data gaps, thin evidence) go in internal_notes.
Process: first call get_overview, get_scale_efficiency, get_category_roles and get_funnel together in one round. Then, only if needed, get contributions or decompose the rate metrics that moved most. Then write the answer.

Final answer: only JSON in this shape:
{"headline":{"text":"...","fact_ids":["F1"]},
"categories":[{"category":"<exact scope name>","role":"<roles from get_category_roles or empty>","text":"...","fact_ids":["F2"]}],
"funnel":{"overall":{"text":"...","fact_ids":[]},"spotlights":[{"category":"<exact scope name>","text":"...","fact_ids":[]}]},
"recommendations":[{"type":"Budget reallocation","text":"...","fact_ids":[]},{"type":"Search term & bidding control","text":"...","fact_ids":[]},{"type":"Creative & ad relevance","text":"...","fact_ids":[]}],
"internal_notes":[{"text":"...","fact_ids":[]}]}`;
}

export const EXTRACT_PROMPT = `The image is a screenshot of a Google search performance dashboard ("Performance Overview"). Read it and reply with only JSON in this shape:
{"brand":string|null,"market":string|null,"period":string|null,"keyword_category":string|null,
"metrics":{"impressions":[value,vs_pp],"clicks":[value,vs_pp],"ctr":[value,vs_pp],"cost":[value,vs_pp],"cpc":[value,vs_pp],"qualified_visits":[value,vs_pp],"clean_qv":[value,vs_pp],"qv_rate":[value,vs_pp],"qv_cpa":[value,vs_pp],"ecomm_clicks":[value,vs_pp],"ecomm_click_rate":[value,vs_pp],"ecomm_click_cpa":[value,vs_pp]}}
Rules:
- value is the big number, as a plain number with no separators, units or signs: "98,655" -> 98655, "4.80%" -> 4.80, "6,665 €" -> 6665, "1.06 €" -> 1.06.
- vs_pp is the FIRST % change under the value (vs previous period), as a signed number: "↓ -13.2%" -> -13.2, "↑ 8.6%" -> 8.6. Ignore the second % change (vs last year).
- Take the sign only from the minus sign or the arrow direction. Never from the colour: red and green mean worse or better, not down or up.
- keyword_category: when a category is selected, the filter reads "Keyword Category: <name>"; return that name. When the filter reads just "Keyword Category" with nothing after it, this is the market total: return null. Never return "Category" or "Keyword Category" as a name.
- If the dashboard shows both "Qualified Visits" and "Clean QV", fill both; if only one is shown, fill that one and set the other to null.
- If a metric shows "No data", set it to the string "no data" instead of an array.
- Use null for anything you cannot read with confidence. Do not guess.`;
