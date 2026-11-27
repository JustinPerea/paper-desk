import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

/**
 * The bench's root. A mock model, so the root costs nothing and does the same thing every run: it calls the tool the
 * message names (JSON {tool, input}) and replies with that tool's output as JSON. Only the subagents call a real model.
 */
export default defineAgent({
  model: mockModel(({ lastUserMessage, toolResults }) => {
    if (toolResults.length > 0) return JSON.stringify(toolResults[0]?.output);
    if (lastUserMessage === null) return "No request.";
    const req = JSON.parse(lastUserMessage) as { tool: string; input: unknown };
    return { toolCalls: [{ name: req.tool, input: req.input }] };
  }),
  defaultTools: false,
});
