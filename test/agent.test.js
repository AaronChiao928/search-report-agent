// Tests the agent loop without calling the real API: a fake client plays Claude's part.
// Reading this test is the quickest way to see the tool-use protocol end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/dataset.js";
import { runAgent } from "../src/agent.js";
import { buildDraft, itemFlags, reportText } from "../src/review.js";

const ds = parseCsv(readFileSync(new URL("../data/demo-gap.csv", import.meta.url), "utf8"), { brand: "Brand A", market: "Market A", period: "Q1 2026" });

function fakeClient() {
  let round = 0;
  return {
    calls: [],
    messages: {
      create: async (req) => {
        round++;
        fake.calls.push(req);
        if (round === 1) {
          // Round 1: Claude asks for two tools at once.
          return { stop_reason: "tool_use", content: [
            { type: "tool_use", id: "t1", name: "get_overview", input: {} },
            { type: "tool_use", id: "t2", name: "get_category_contributions", input: { metric: "clicks" } },
          ] };
        }
        // Round 2: Claude has the results and writes its answer, citing fact IDs.
        const results = req.messages.at(-1).content;
        const overview = JSON.parse(results[0].content);
        const clicks = overview.market.Clicks.change; // e.g. "-15.0% [F4]"
        const [value, id] = clicks.match(/^(.*) \[(F\d+)\]$/).slice(1);
        return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({
          headline: { text: `Clicks moved ${value} vs the previous period, and 42.4% came from nowhere.`, fact_ids: [id] },
          categories: [{ category: "Tapes", role: "Cost bottleneck (Clean QV)", text: "Tapes saw rising costs.", fact_ids: [] }],
          funnel: { overall: { text: "The funnel held up.", fact_ids: [] }, spotlights: [] },
          recommendations: [{ type: "Budget reallocation", text: "Shift budget to Cordless Platform.", fact_ids: [] }],
          internal_notes: [],
        }) }] };
      },
    },
  };
}
const fake = fakeClient();

test("agent loop: runs requested tools, returns tool results, then parses the answer", async () => {
  const { output, registry, scopes, trace } = await runAgent({ ds, client: fake });
  assert.equal(fake.calls.length, 2);
  // The request object is shared with the loop, so find the message that carried the tool results.
  const toolResults = fake.calls[1].messages.find((m) => m.role === "user" && Array.isArray(m.content)).content;
  assert.equal(toolResults[0].type, "tool_result");
  assert.equal(toolResults[0].tool_use_id, "t1");
  assert.equal(trace.length, 3);

  const draft = buildDraft(output, scopes, registry);
  // The invented "42.4%" is caught; the cited clicks change is not.
  assert.deepEqual(draft.headline.check.map((c) => c.ok), [true, false]);
  // Tapes holds two bottleneck roles; the agent named only one, so it's flagged.
  assert.ok(itemFlags(draft.cats[0], registry).some((f) => f.startsWith("agent said role")));
  // A recommendation with no supporting number is flagged.
  assert.ok(itemFlags(draft.recs[0], registry).includes("no number backs this recommendation"));
  // Missing bullets and recommendation types are reported as issues.
  assert.ok(draft.issues.some((i) => i.startsWith("No bullet was returned")));
  // The report never contains fact IDs.
  assert.ok(!/\bF\d+\b/.test(reportText(draft, ds.meta)));
});
