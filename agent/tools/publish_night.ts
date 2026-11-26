import { defineTool } from "eve/tools";
import { z } from "zod";
import { APP_LOGIN, gh, NIGHT_BRANCH, repoPath } from "../lib/github";

/**
 * The only side effect that publishes: merging a night PR. There is no human approval step (Justin's choice,
 * 2026-11-26): the merge happens only when the deterministic checks below pass, so the model can't publish
 * anything else. Justin reviews nights after they land and can revert one.
 */
export default defineTool({
  description: "Merge a night pull request once its checks pass.",
  inputSchema: z.object({ pr: z.number().int().positive(), head_sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  async execute({ pr, head_sha }) {
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
    const outside = files.filter((f) => !f.filename.startsWith(`nights/${night[1]}/`));
    if (outside.length) throw new Error(`PR #${pr} touches files outside nights/${night[1]}/: ${outside.map((f) => f.filename).join(", ")}`);
    // TODO piece 4, required before the first real night: re-run the verifier on the PR's record.json and
    // script.json here and refuse the merge on any failure. With no human gate, this is the only content check.
    // `sha` makes GitHub refuse the merge if the head moved after the checks above.
    const merged = await gh<{ merged: boolean; sha: string }>("PUT", repoPath(`/pulls/${pr}/merge`), { merge_method: "squash", sha: head_sha });
    return { merged: merged.merged, sha: merged.sha };
  },
});
