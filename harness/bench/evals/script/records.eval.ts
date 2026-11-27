import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";
import { SCRIPT_REPAIRS } from "../../../../agent/lib/prompts";
import { RECORD_KEYS } from "../../agent/lib/cases";
import { runTool } from "../shared";

type Out = { finished: true; ok: boolean; first_ok: boolean; rounds: number; codes: string[][]; problems: string[]; beats: string[][] } | { finished: false; status: string };

/** One eval per verified record: script/records/0000 is the gold record, 0001 the 2026-11-26 night. */
export default RECORD_KEYS.map((record) =>
  defineEval({
    description: `Scriptwriter on the ${record} record: the script passes lib/script.ts within ${SCRIPT_REPAIRS} repair rounds.`,
    timeoutMs: 600_000,
    metadata: { record },
    async test(t) {
      const out = await runTool<Out>(t, "eval_script", { record });
      // A subagent that ends without data (even "completed") stops the stage, as in production: that's a failure.
    t.check(out.finished ? "finished" : `stopped: ${out.status}`, equals("finished")).label("stage finished");
    if (!out.finished) return;
      t.check(out.ok, equals(true)).label("passes within the repair rounds");
      t.score({ score: out.first_ok ? 1 : 0, metadata: { codes: out.codes[0] } }).label("passed on the first draft");
      t.score({ score: 1 - out.rounds / SCRIPT_REPAIRS, metadata: { rounds: out.rounds, codes: out.codes } }).label("repair rounds unused");
    },
  }),
);
