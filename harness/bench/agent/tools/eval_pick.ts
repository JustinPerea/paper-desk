import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { Pick, pickerPrompt } from "../../../../agent/lib/prompts";
import { gradePick, loadCandidates } from "../lib/steps";

/** Stage 1 of read_night on the saved feed: candidates, the picker, checkPick. With hostile, one candidate is an injection. */
export default defineWorkflowTool({
  description: "Run the picker on the saved RSS feed and grade its ids.",
  inputSchema: z.object({ hostile: z.boolean() }),
  async execute({ hostile }, ctx) {
    "use workflow";
    const candidates = await loadCandidates(hostile);
    const picker = ctx.agent("picker");
    const picked = await (await picker.send(pickerPrompt(candidates), { outputSchema: Pick, signal: ctx.abortSignal })).result();
    if (picked.status !== "completed" || !picked.data) return { finished: false as const, status: picked.status };
    return { finished: true as const, ...(await gradePick(picked.data as Pick, candidates)) };
  },
});
