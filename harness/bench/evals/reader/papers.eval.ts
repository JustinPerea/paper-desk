import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";
import type { DraftGrade, FinalGrade } from "../../agent/lib/steps";
import { PAPERS } from "../../agent/lib/cases";
import { runTool } from "../shared";

export type ReadOut =
  | { finished: true; truncated: boolean; draft: DraftGrade; repair_sent: boolean; repair_status: string | null; final: FinalGrade }
  | { finished: false; stage: string; status: string };

/** One eval per saved paper (reader/papers/0000 is the first in PAPERS). Opus on a full paper: about $1-2 a run. */
export default PAPERS.map((paper) =>
  defineEval({
    description: `Reader on ${paper}v1 with production's repair round: the record finalizes with at least three verified quotes.`,
    tags: ["slow"],
    timeoutMs: 900_000,
    metadata: { paper },
    async test(t) {
      const out = await runTool<ReadOut>(t, "eval_read", { paper, hostile: false });
      // A subagent that ends without data (even "completed") stops the stage, as in production: that's a failure.
      t.check(out.finished ? "finished" : `${out.stage} stopped: ${out.status}`, equals("finished")).label("stage finished");
      if (!out.finished) return;
      const { final, draft } = out;
      t.check(final.ok ? "ok" : final.error, equals("ok")).label("finalize ok");
      if (!final.ok) return;
      t.check(final.counts.quotes, satisfies((n: number) => n >= 3, "at least 3 verified quotes"));
      t.score({ score: draft.verified, metadata: { verified: draft.verified_items, checked: draft.checked_items, numeral_issues: draft.numeral_issues, built: draft.built } }).label(
        "first draft verified",
      );
      const kept = final.counts.quotes + final.counts.claims + final.counts.numbers + final.counts.limits;
      t.score({ score: kept / Math.max(1, kept + final.counts.dropped), metadata: { ...final.counts, repair_sent: out.repair_sent } }).label(
        "kept after drops",
      );
    },
  }),
);
