import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

/**
 * Ranks tonight's candidates. It sees only titles and abstracts (untrusted text) and has no tools, so a hostile
 * abstract can at most skew the ranking; read_night checks every id it returns against the candidate list.
 * Only read_night calls it (tool: false).
 */
export default defineAgent({
  description: "Rank tonight's new arXiv papers for a full read.",
  model: anthropic("claude-sonnet-5-5"),
  tool: false,
  defaultTools: false,
  limits: {
    sessionUsage: ({ window }) => window.inputTokens - window.cacheReadTokens >= 150_000 || window.outputTokens >= 10_000,
  },
});
