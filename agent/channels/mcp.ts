import { none } from "eve/channels/auth";
import { mcpChannel } from "eve/channels/mcp";

/**
 * Public MCP server at /eve/v1/mcp. It serves the agent's tools for direct calls (no model run) and not the
 * agent_* tools, so anonymous callers can't spend the model key. Every tool with `execute` is published:
 * get_night is the public one, and read_night and publish_night refuse any caller but the nightly session or
 * Justin (agent/lib/caller.ts).
 */
export default mcpChannel({
  auth: none(),
  agent: false,
  tools: true,
});
