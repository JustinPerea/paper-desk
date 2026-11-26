import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

/**
 * Root agent. Models are direct Anthropic instances (Justin's own key, card #3479), never Gateway strings:
 * a model string routes through AI Gateway even when the parent uses a direct provider (eve 1.5.0 changelog).
 */
export default defineAgent({
  model: anthropic("claude-sonnet-5-5"),
  // No bash, file, web or agent tools. The sandbox adds the GitHub App's auth to outbound git, so a model
  // with bash could push past the approval gate. The only tools are read_night and publish_night.
  defaultTools: false,
  limits: {
    // eve reports dollar cost only through AI Gateway, so on a direct key this cap counts tokens.
    // Sized to about $3 a night at list prices; revisited after three real nights.
    sessionUsage: ({ window }) =>
      window.inputTokens - window.cacheReadTokens >= 400_000 || window.outputTokens >= 60_000,
  },
});
