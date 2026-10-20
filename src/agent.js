// Step 4: the agent loop.
// Standard Messages API tool use: send the prompt and tool definitions; while Claude
// answers with stop_reason "tool_use", run each requested tool locally and send the
// results back as tool_result blocks; stop when Claude writes its final answer.

import { FactRegistry } from "./facts.js";
import { buildTools } from "./tools.js";
import { analysisPrompt } from "./prompts.js";

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const MAX_ROUNDS = 8; // guardrail: the agent can't loop forever

/**
 * @param {object} opts
 * @param {object} opts.ds      dataset (see dataset.js)
 * @param {object} opts.client  an Anthropic SDK client (injected so tests can use a fake)
 * @param {function} [opts.onTrace] called with a line of text for each step
 * @returns {{ output: object, registry: FactRegistry, scopes: object, trace: string[] }}
 */
export async function runAgent({ ds, client, model = DEFAULT_MODEL, onTrace = () => {} }) {
  const registry = new FactRegistry();
  const { tools, scopes } = buildTools(ds, registry);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const apiTools = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const trace = [];
  const log = (line) => { trace.push(line); onTrace(line); };

  const messages = [{ role: "user", content: analysisPrompt(ds, scopes) }];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const res = await client.messages.create({ model, max_tokens: 8000, tools: apiTools, messages });
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      log(`Round ${round}: final answer`);
      return { output: parseJson(text), registry, scopes, trace };
    }

    // Run every tool Claude asked for in this round and return all results together.
    const results = [];
    for (const call of res.content.filter((b) => b.type === "tool_use")) {
      const tool = byName[call.name];
      try {
        if (!tool) throw new Error(`Unknown tool ${call.name}`);
        const out = tool.run(call.input || {});
        log(`Round ${round}: ${call.name}(${JSON.stringify(call.input || {})})`);
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
      } catch (err) {
        // Errors go back to Claude, which can correct itself (e.g. avoid a metric with no data).
        log(`Round ${round}: ${call.name} failed: ${err.message}`);
        results.push({ type: "tool_result", tool_use_id: call.id, content: `Error: ${err.message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error(`Agent did not finish within ${MAX_ROUNDS} rounds`);
}

/** Read a JSON value from model text: whole text, a ```json fence, or first { to last }. */
export function parseJson(text) {
  const tries = [text, (text.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const t of tries) {
    if (!t) continue;
    try { return JSON.parse(t); } catch { /* try next */ }
  }
  throw new Error("The agent's answer was not valid JSON:\n" + text.slice(0, 500));
}
