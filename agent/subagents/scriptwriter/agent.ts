import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

/**
 * Writes the video script from the verified record only, never from the paper. No tools; lib/script.ts checks
 * every number it uses. Only read_night calls it (tool: false).
 */
export default defineAgent({
  description: "Write a 60 to 110 second video script from a verified paper record.",
  model: anthropic("claude-sonnet-5-5"),
  tool: false,
  defaultTools: false,
  limits: {
    sessionUsage: ({ window }) => window.inputTokens - window.cacheReadTokens >= 150_000 || window.outputTokens >= 20_000,
  },
});
