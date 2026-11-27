import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

/**
 * Reads one paper into a record. The paper text is hostile data: the reader has no tools at all, and everything it
 * returns is checked by lib/verify.ts before it reaches the repo. Only read_night calls it (tool: false).
 */
export default defineAgent({
  description: "Read one paper's text into a structured record of claims, quotes and numbers.",
  model: anthropic("claude-opus-5-5"),
  tool: false,
  defaultTools: false,
  limits: {
    sessionUsage: ({ window }) => window.inputTokens - window.cacheReadTokens >= 400_000 || window.outputTokens >= 60_000,
  },
});
