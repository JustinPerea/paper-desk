import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Source checks for the wiring the evals can't see. The evals drive copies (the bench's tools, the gate harness's
 * channel), so these pin the production files to the same shared pieces.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("read_night takes the picker schema, repair rounds and repair message from prompts.ts", () => {
  const src = read("agent/tools/read_night.ts");
  assert.match(src, /import \{[^}]*\bPick\b[^}]*\bSCRIPT_REPAIRS\b[^}]*\bscriptRepairPrompt\b[^}]*\} from "\.\.\/lib\/prompts"/);
  assert.doesNotMatch(src, /const SCRIPT_REPAIRS|const Pick\b|Problems found:/);
});

test("read_night checks the caller before anything else", () => {
  const src = read("agent/tools/read_night.ts");
  const body = src.slice(src.indexOf('"use workflow";') + '"use workflow";'.length);
  assert.match(body, /^\s*await checkRunner\(ctx\.session\.auth\.current\);/);
});

test("the production GitHub channel uses the shared comment gate and opts into no other events", () => {
  const src = read("agent/channels/github.ts");
  assert.match(src, /onComment:\s*justinOnlyComments\b/);
  assert.doesNotMatch(src, /\bon(Issue|PullRequest|CheckSuite|CheckRun|WorkflowRun)\s*[:(]/);
});

test("the schedule sends the message the root evals use", () => {
  assert.match(read("agent/schedules/night.ts"), /send\(\s*nightMessage\(date\)/);
});
