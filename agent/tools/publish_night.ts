import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { gh, JUSTIN_PRINCIPAL_ID, NIGHT_BRANCH, repoPath } from "../lib/github";

/**
 * The only side effect that publishes: merging a night PR. It always needs approval, and only Justin's GitHub
 * account can answer (approve or deny). A scheduled session runs as the app, so the default "requester answers"
 * rule would never match a person; the response policy names him instead.
 *
 * The gate stops the model and outsiders. It does not stop a local session holding Justin's GitHub token, which
 * can comment as him; agents must never post the approval.
 */
export default defineTool({
  description: "Merge a night pull request after Justin approves it on GitHub.",
  inputSchema: z.object({ pr: z.number().int().positive(), head_sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  approval: {
    request: always(),
    response: ({ response }) =>
      response.principal.principalId === JUSTIN_PRINCIPAL_ID && response.principal.authenticator === "github-webhook"
        ? { status: "allowed" }
        : { status: "rejected", reason: "Only Justin can answer this." },
  },
  async execute({ pr, head_sha }) {
    const p = await gh<{
      state: string;
      head: { ref: string; sha: string; repo: { full_name: string } };
      base: { ref: string; repo: { full_name: string } };
      user: { type: string };
    }>("GET", repoPath(`/pulls/${pr}`));
    const night = NIGHT_BRANCH.exec(p.head.ref);
    if (p.state !== "open") throw new Error(`PR #${pr} is ${p.state}`);
    if (!night) throw new Error(`PR #${pr} head ${p.head.ref} is not a night branch`);
    if (p.head.repo.full_name !== p.base.repo.full_name || p.base.ref !== "main") throw new Error(`PR #${pr} is not night -> main in this repo`);
    if (p.user.type !== "Bot") throw new Error(`PR #${pr} was not opened by the App`);
    if (p.head.sha !== head_sha) throw new Error(`PR #${pr} changed after it was opened (head ${p.head.sha})`);
    const files = await gh<{ filename: string }[]>("GET", repoPath(`/pulls/${pr}/files?per_page=100`));
    const outside = files.filter((f) => !f.filename.startsWith(`nights/${night[1]}/`));
    if (outside.length) throw new Error(`PR #${pr} touches files outside nights/${night[1]}/: ${outside.map((f) => f.filename).join(", ")}`);
    // TODO piece 4: re-run the verifier on the PR's record.json and script.json before merging.
    // `sha` makes GitHub refuse the merge if the head moved after the checks above.
    const merged = await gh<{ merged: boolean; sha: string }>("PUT", repoPath(`/pulls/${pr}/merge`), { merge_method: "squash", sha: head_sha });
    return { merged: merged.merged, sha: merged.sha };
  },
});
