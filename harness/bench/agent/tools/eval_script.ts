import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { ScriptOutput } from "../../../../lib/script-schema";
import { SCRIPT_REPAIRS, scriptRepairPrompt } from "../../../../agent/lib/prompts";
import { RECORD_KEYS } from "../lib/cases";
import { checkScriptOutput, loadRecord, scriptBrief } from "../lib/steps";

/** Step 5 of read_night on a saved verified record: the draft, then up to SCRIPT_REPAIRS repair rounds. */
export default defineWorkflowTool({
  description: "Run the scriptwriter on a saved verified record, with production's repair rounds, and grade the script.",
  inputSchema: z.object({ record: z.enum(RECORD_KEYS) }),
  async execute({ record }, ctx) {
    "use workflow";
    const recordJson = await loadRecord(record);
    const writer = ctx.agent("scriptwriter");
    const brief = await scriptBrief(recordJson);
    const draft = await (await writer.send(brief, { outputSchema: ScriptOutput, signal: ctx.abortSignal })).result();
    if (draft.status !== "completed" || !draft.data) return { finished: false as const, status: draft.status };
    let script = await checkScriptOutput(recordJson, draft.data);
    const first_ok = script.ok;
    // Each round's codes and problem lines (the checker's own text, sent back as the repair message), for the log.
    const codes: string[][] = [script.codes];
    const problems: string[] = [script.problems.slice(0, 800)];
    const beats: string[][] = [beatKinds(draft.data)];
    let rounds = 0;
    for (let round = 0; round < SCRIPT_REPAIRS && !script.ok; round++) {
      const fixed = await (await writer.send(scriptRepairPrompt(script.problems), { outputSchema: ScriptOutput, signal: ctx.abortSignal })).result();
      if (fixed.status !== "completed" || !fixed.data) break;
      rounds++;
      script = await checkScriptOutput(recordJson, fixed.data);
      codes.push(script.codes);
      problems.push(script.problems.slice(0, 800));
      beats.push(beatKinds(fixed.data));
    }
    return { finished: true as const, ok: script.ok, first_ok, rounds, codes, problems, beats };
  },
});

/** The beat kinds of one draft, in order, so a beat-count failure can be read from the log. */
function beatKinds(data: unknown): string[] {
  const beats = (data as { beats?: { kind?: unknown }[] }).beats;
  return Array.isArray(beats) ? beats.map((b) => String(b?.kind)) : [];
}
