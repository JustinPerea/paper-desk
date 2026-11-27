import { defineEvalConfig } from "eve/evals";

// Two at a time keeps the reader (Opus on a full paper) under the provider's rate limits. A reader eval with its
// repair round can take several minutes, so the default timeout is generous; the cheaper evals finish well inside it.
export default defineEvalConfig({
  maxConcurrency: 2,
  timeoutMs: 900_000,
});
