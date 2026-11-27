import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineInstructions } from "eve/instructions";

// Asset imports can't leave this package, so read the production file at build time (this module runs only then).
// eve runs from harness/bench/, so the production agent is two levels up.
export default defineInstructions({
  content: readFileSync(resolve(process.cwd(), "../../agent/subagents/picker/instructions.md"), "utf8"),
});
