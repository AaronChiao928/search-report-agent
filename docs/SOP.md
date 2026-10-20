# SOP: running a search performance report with the agent

Audience: analysts preparing the search section of a client report. Time: about 15 minutes per market.

## 1. Before you start

- Access to the search dashboard for the brand and market.
- Either the web prototype opened in Claude, or this repository with an API key in `.env`.
- Confirm you're allowed to send this client's data to the model. If not, anonymise brand names first.

## 2. Get the data

**Option A: CSV (most accurate).** Export the market total and each keyword category from the dashboard into the template (`node src/cli.js check` prints errors if a column is missing):

```
scope,impr,impr_vs_pp,clicks,clicks_vs_pp,cost,cost_vs_pp,qv,qv_vs_pp,ec,ec_vs_pp
Market total,98655,-13.2,4736,-15.0,6665,-12.1,1787,-36.5,418,-6.3
Cordless Platform,35452,-6.4,2041,-0.6,2063,5.3,949,-24.7,228,33.3
```

- First row is always the market total.
- `qv` is **Clean QV**. Percentages are vs previous period, as numbers (`-13.2`, not `-13.2%`).
- Leave a cell empty if the dashboard shows "No data". Never type 0 for "No data".

**Option B: screenshots.**

- One screenshot per scope: the market total (Keyword Category filter with nothing selected) and one per category.
- Size about 2,000 × 500 px. Zoom the browser to 150–200% before capturing; on a Retina screen 100–125% is enough. Don't split one scope across two images.
- Include the brand, market and date filters if you can; otherwise type them in afterwards.

## 3. Run the checks

Web: upload, then look at each screenshot's badge and at step 2. CLI: `node src/cli.js check <file.csv>`.

| You see | Do this |
|---|---|
| A screenshot check failed | Open the screenshot, compare the named metric, correct the value in the table |
| "Value couldn't be read" | Type it in from the screenshot |
| Categories don't add up to the market | Check the category mapping in the dashboard. If the gap is real (paused or uncategorised keywords), carry on: it's analysed as "keywords outside the reported categories" |
| A metric has "No data" for a category | Fine. It's discussed at market level only |

Don't run the agent until the checks are clean or every flag is understood.

## 4. Run the agent

Web: step 4, "Run agent". CLI: `node --env-file=.env src/cli.js analyse <file.csv> --brand X --market Y --period Z`.

The trace shows which tools the agent called. A normal run takes one to three rounds.

## 5. Review

Work through the draft in this order. In the CLI, use `out/review.md`; it lists every part with its flags and sources.

1. **Flags first.** Each flag names its problem:
   - *Number not found*: the agent wrote a number that isn't in the calculations. Correct or remove it.
   - *Cites a source that doesn't exist*: treat the sentence as unsupported.
   - *Agent said role X, rules give Y*: the label uses the rule's role; rewrite the sentence to match.
   - *Internal wording*: replace "rate effect", "mix effect", "scope" or IDs with client language.
   - *No number backs this recommendation*: reject, or rewrite with evidence.
2. **Logic.** Does each explanation follow from its sources? Open "Sources" to see them. Pay attention to categories with two roles and to anything about keywords outside the reported categories.
3. **Recommendations.** Check each against what the agent can't see: budget caps, seasonality, tests in flight, client priorities. Approve or reject individually.
4. **Choose.** Remove bullets you won't use, edit wording, then approve the analysis.

## 6. Export

Copy the report text (web) or edit `out/report.md` (CLI). Only approved content is included and no source IDs appear. Paste into the report and finish the narrative by hand.

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| Many screenshot checks fail | Retake at higher resolution; or use CSV |
| Market screenshot read as a category | Make sure nothing is selected in the Keyword Category filter; retake |
| "Agent did not finish within 8 rounds" | Run again; if repeated, check the data for extreme values |
| "Answer was not valid JSON" | Run again |
| Rate limit or API error | Wait a minute and run again |

## 8. Extending

| Change | Where | Notes |
|---|---|---|
| Thresholds (role share, diminishing returns, funnel) | `src/rules.js`, `src/checks.js` constants | Agree changes with the team; add a decision-log entry in DESIGN.md |
| Add a base metric | `BASE` in `src/metrics.js`, CSV template, extraction prompt | Ratios are rebuilt automatically from base metrics |
| Add a ratio | `RATIOS` in `src/metrics.js` | Decomposition and verification work automatically |
| New role | `roles()` in `src/rules.js`, role list in the prompt | Add a test in `test/core.test.js` |
| Change report structure | `analysisPrompt` in `src/prompts.js`, `buildDraft` and `reportText` in `src/review.js` | Keep the fact-ID requirement |
| Different model or platform | `src/agent.js`, `src/extract.js` | Everything else is model-agnostic |

Run `npm test` after any change. Until the web page loads `src/` directly, mirror the same change in `web/index.html` so both versions give the same results.

## 9. Change control

Rule and prompt changes affect client-facing conclusions. Record each change in the decision log (DESIGN.md §10) with the reason, and rerun the demo data to compare outputs before and after.
