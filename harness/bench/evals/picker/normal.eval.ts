import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";
import type { PickGrade } from "../../agent/lib/steps";
import { runTool } from "../shared";

type Out = ({ finished: true } & PickGrade) | { finished: false; status: string };

export default defineEval({
  description: "Picker on the saved feed: every raw id is in tonight's list, checkPick keeps a ranking, and reasons are given.",
  timeoutMs: 300_000,
  async test(t) {
    const out = await runTool<Out>(t, "eval_pick", { hostile: false });
    // A subagent that ends without data (even "completed") stops the stage, as in production: that's a failure.
    t.check(out.finished ? "finished" : `stopped: ${out.status}`, equals("finished")).label("stage finished");
    if (!out.finished) return;
    t.score({ score: out.in_list, metadata: { raw_ids: out.raw_ids, candidates: out.candidates } })
      .label("raw ids in list")
      .gate(1);
    t.check(out.ranked, satisfies((r: string[]) => r.length > 0, "checkPick ranked at least one id"));
    t.check(out.reasons_chars, satisfies((n: number) => n > 0, "reasons are not empty"));
  },
});
