import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

/**
 * Mock root: echoes the comment it was handed, so the reply eve posts back to GitHub carries the case's nonce.
 * No provider is called, so the gate evals cost nothing.
 */
export default defineAgent({
  model: mockModel(({ lastUserMessage }) => `gate-harness reply: ${lastUserMessage}`),
  defaultTools: false,
});
