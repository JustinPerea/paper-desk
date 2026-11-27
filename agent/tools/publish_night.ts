import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireNightRunner } from "../lib/caller";
import { APP_LOGIN, gh, NIGHT_BRANCH, repoPath } from "../lib/github";
import { checkNight } from "../lib/publish-check";

/**
 * The only side effect that publishes: merging a night PR. There is no human approval step (Justin's choice,
 * 2026-11-26): the merge happens only when the deterministic checks below pass, so the model can't publish
 * anything else. Justin reviews nights after they land and can revert one.
 */
/** The only files a night PR may change. The script and video join in pieces 4 and 7. */
const NIGHT_FILES = ["record.json", "verification.json", "script.json", "video.mp4"];

export default defineTool({
  description: "Merge a night pull request once its checks pass.",
  inputSchema: z.object({ pr: z.number().int().positive(), head_sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  async execute({ pr, head_sha }, ctx) {
    requireNightRunner(ctx.session.auth.current, "publish_night");
    const p = await gh<{
      state: string;
      head: { ref: string; sha: string; repo: { full_name: string } };
      base: { ref: string; repo: { full_name: string } };
      user: { login: string };
    }>("GET", repoPath(`/pulls/${pr}`));
    const night = NIGHT_BRANCH.exec(p.head.ref);
    if (p.state !== "open") throw new Error(`PR #${pr} is ${p.state}`);
    if (!night) throw new Error(`PR #${pr} head ${p.head.ref} is not a night branch`);
    if (p.head.repo.full_name !== p.base.repo.full_name || p.base.ref !== "main") throw new Error(`PR #${pr} is not night -> main in this repo`);
    if (p.user.login !== APP_LOGIN) throw new Error(`PR #${pr} was opened by ${p.user.login}, not ${APP_LOGIN}`);
    if (p.head.sha !== head_sha) throw new Error(`PR #${pr} changed after it was opened (head ${p.head.sha})`);
    const files = await gh<{ filename: string }[]>("GET", repoPath(`/pulls/${pr}/files?per_page=100`));
    const allowed = new Set(NIGHT_FILES.map((name) => `nights/${night[1]}/${name}`));
    const unexpected = files.filter((f) => !allowed.has(f.filename));
    if (unexpected.length) throw new Error(`PR #${pr} changes files other than a night's own: ${unexpected.map((f) => f.filename).join(", ")}`);
    const names = new Set(files.map((f) => f.filename.slice(`nights/${night[1]}/`.length)));
    if (!names.has("record.json") || !names.has("script.json")) throw new Error(`PR #${pr} needs both record.json and script.json`);
    // With no human gate this is the content check: the record must verify cleanly against the paper's page,
    // fetched again here, and the script must pass its check against that record. Both are read at head_sha.
    const problems = await checkNight(night[1]!, head_sha);
    if (problems.length) throw new Error(`PR #${pr} failed the final check: ${problems.slice(0, 6).join("; ")}`);
    // `sha` makes GitHub refuse the merge if the head moved after the checks above.
    const merged = await gh<{ merged: boolean; sha: string }>("PUT", repoPath(`/pulls/${pr}/merge`), { merge_method: "squash", sha: head_sha });
    return { merged: merged.merged, sha: merged.sha };
  },
});
