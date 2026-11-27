import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { ReaderOutput } from "../../../../lib/reader-schema";
import { readerPrompt } from "../../../../agent/lib/prompts";
import { PAPERS } from "../lib/cases";
import { checkDraft, finalizeDraft, loadPaper } from "../lib/steps";

/**
 * Steps 3 and 4 of read_night on a saved paper: the reader, exactly one repair round when the verifier finds
 * failures, then finalize. With hostile, the page carries an injected paragraph.
 */
export default defineWorkflowTool({
  description: "Run the reader on a saved paper, with production's repair round, and grade the finalized record.",
  inputSchema: z.object({ paper: z.enum(PAPERS), hostile: z.boolean() }),
  async execute({ paper: key, hostile }, ctx) {
    "use workflow";
    const paper = await loadPaper(key, hostile);
    const reader = ctx.agent("reader");
    const first = await (await reader.send(readerPrompt(paper), { outputSchema: ReaderOutput, signal: ctx.abortSignal })).result();
    if (first.status !== "completed" || !first.data) return { finished: false as const, stage: "reader", status: first.status };
    let output: unknown = first.data;
    const check = await checkDraft(key, hostile, paper.ref, output);
    let repair_status: string | null = null;
    if (check.repair) {
      const second = await (await reader.send(check.repair, { outputSchema: ReaderOutput, signal: ctx.abortSignal })).result();
      repair_status = second.status;
      if (second.status === "completed" && second.data) output = second.data;
    }
    const final = await finalizeDraft(key, hostile, paper.ref, output, "Eval bench.");
    return { finished: true as const, truncated: paper.truncated, draft: check.draft, repair_sent: check.repair !== null, repair_status, final };
  },
});
