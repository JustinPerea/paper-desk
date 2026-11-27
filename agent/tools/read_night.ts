import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { ReaderOutput } from "../../lib/reader-schema";
import { ScriptOutput } from "../../lib/script-schema";
import {
  checkNight,
  checkOutput,
  checkScriptOutput,
  checkPick,
  checkRunner,
  claimNight,
  fetchCandidates,
  fetchPaperText,
  finalizeRecord,
  openNightPr,
  releaseNight,
  scriptBrief,
  type PaperText,
} from "../lib/night-steps";
import { Pick, pickerPrompt, readerPrompt, SCRIPT_REPAIRS, scriptRepairPrompt } from "../lib/prompts";

/** How many of the picker's ranked papers to try before giving up (a paper may have no HTML). */
const TRY_PAPERS = 3;

/**
 * One night: candidates from arXiv, the picker, the reader, the verifier (one repair round), then a PR with the
 * verified record. Everything the root model sees is built here from counts and ids, never the reader's prose.
 * A workflow tool, so the MCP channel does not publish it.
 */
export default defineWorkflowTool({
  description:
    "Read tonight's paper (or the arXiv id Justin names) and open a pull request with the verified record and the video script. Returns the PR number, its head commit, whether anything verified, whether it's ready to publish, and a summary built from counts.",
  inputSchema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    arxiv_id: z
      .string()
      .regex(/^\d{4}\.\d{4,5}$/)
      .optional()
      .describe("Only when Justin names a paper; otherwise tonight's feed is used."),
  }),
  async execute({ date, arxiv_id }, ctx) {
    "use workflow";
    await checkRunner(ctx.session.auth.current);
    const night = await checkNight(date);
    if (night.published) return nothingTonight(`Night ${date} is already published.`);
    if (night.open_pr !== null && !arxiv_id) return nothingTonight(`Night ${date} already has PR #${night.open_pr} open.`);
    // A scheduled run claims the night's branch first, so two runs for one date can't write over each other. A rerun
    // Justin asks for (arxiv_id) reuses the branch.
    let claimed: string | null = null;
    if (!arxiv_id) {
      claimed = await claimNight(date);
      if (claimed === null) return nothingTonight(`Night ${date} already has a branch, from another run or a failed one. Delete night/${date} or name a paper to rerun.`);
    }
    const stop = async (summary: string) => {
      if (claimed !== null) await releaseNight(date, claimed);
      return nothingTonight(summary);
    };

    // 1. Candidates and the pick.
    let ranked: string[];
    let pickReasons = "";
    if (arxiv_id) {
      ranked = [arxiv_id];
      pickReasons = "Named by Justin.";
    } else {
      const candidates = await fetchCandidates();
      if (candidates.length === 0) return await stop("arXiv's feed has no new, unread papers tonight.");
      const picker = ctx.agent("picker");
      const picked = await (await picker.send(pickerPrompt(candidates), { outputSchema: Pick, signal: ctx.abortSignal })).result();
      if (picked.status !== "completed" || !picked.data) return await stop(`The picker didn't finish (${picked.status}).`);
      const checked = await checkPick(picked.data as Pick, candidates);
      ranked = checked.ranked;
      if (ranked.length === 0) return await stop("The picker returned no id from tonight's list.");
      pickReasons = checked.reasons;
    }

    // 2. The first ranked paper with arXiv HTML.
    let paper: PaperText | null = null;
    for (const id of ranked.slice(0, TRY_PAPERS)) {
      paper = await fetchPaperText(id);
      if (paper) break;
    }
    if (!paper) return await stop(`No arXiv HTML for ${ranked.slice(0, TRY_PAPERS).join(", ")}.`);

    // 3. The reader, then one repair round if the verifier finds failures.
    const reader = ctx.agent("reader");
    const first = await (await reader.send(readerPrompt(paper), { outputSchema: ReaderOutput, signal: ctx.abortSignal })).result();
    if (first.status !== "completed" || !first.data) return await stop(`The reader didn't finish (${first.status}).`);
    let output: unknown = first.data;
    const check = await checkOutput(paper.ref, output);
    if (check.repair) {
      const second = await (await reader.send(check.repair, { outputSchema: ReaderOutput, signal: ctx.abortSignal })).result();
      if (second.status === "completed" && second.data) output = second.data;
    }

    // 4. Verify, drop failures, and open the PR.
    const final = await finalizeRecord(paper.ref, output, pickReasons);
    if (!final.ok) return await stop(`The record was malformed: ${final.error}`);
    if (final.counts.quotes === 0) return await stop(`Nothing in the reader's record for ${paper.ref.arxiv_id} verified.`);
    // 5. The script, from the verified record only, with one repair round.
    const writer = ctx.agent("scriptwriter");
    let script = { ok: false, problems: "", codes: ["not_run"], scriptJson: null as string | null };
    const brief = await scriptBrief(final.recordJson);
    const draft = await (await writer.send(brief, { outputSchema: ScriptOutput, signal: ctx.abortSignal })).result();
    if (draft.status === "completed" && draft.data) {
      script = await checkScriptOutput(final.recordJson, draft.data);
      for (let round = 0; round < SCRIPT_REPAIRS && !script.ok; round++) {
        const fixed = await (await writer.send(scriptRepairPrompt(script.problems), { outputSchema: ScriptOutput, signal: ctx.abortSignal })).result();
        if (fixed.status !== "completed" || !fixed.data) break;
        script = await checkScriptOutput(final.recordJson, fixed.data);
      }
    }

    const pr = await openNightPr(date, paper.ref, final.recordJson, final.verificationJson, script, final.counts);
    const c = final.counts;
    return {
      pr: pr.number,
      url: pr.url,
      head_sha: pr.head_sha,
      verified: true,
      ready_to_publish: script.ok,
      summary:
        `${paper.ref.arxiv_id}${paper.ref.version}: ${c.quotes} quotes, ${c.claims} claims, ${c.numbers} numbers and ${c.limits} limits verified; ${c.dropped} items dropped.` +
        (paper.truncated ? " The paper was longer than the reader's budget and was cut." : "") +
        (script.ok ? " The script passed its check." : ` The script failed its check (${script.codes.join(", ")}), so the PR stays open.`),
    };
  },
});

function nothingTonight(summary: string) {
  return { pr: null, url: null, head_sha: null, verified: false, ready_to_publish: false, summary };
}
