import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import type { GateRecord } from "../agent/lib/record";
import { equals, satisfies } from "eve/evals/expect";
import { activityFor, freshInstallation, freshIssue, reviewComment, STRANGER, waitFor, webhookInit } from "./webhook";

const QUIET_MS = 15_000;

/**
 * A stranger's signed review comment on a pull request's diff (pull_request_review_comment), which eve routes
 * through the same onComment gate as issue comments, starts nothing either.
 */
export default defineEval({
  timeoutMs: 120_000,
  async test(t) {
    const pull = freshIssue();
    const installation = freshInstallation();
    const init = webhookInit(JSON.stringify(reviewComment(STRANGER, pull, randomUUID(), installation)), undefined, "pull_request_review_comment");
    const res = await t.target.fetch("/eve/v1/github", init);
    t.check(res.status, equals(200));
    t.check(await res.json(), equals({ ok: true }));

    const gate = await waitFor((r) => r.kind === "gate" && r.deliveryId === init.deliveryId, 30_000);
    t.check(gate, satisfies((g: typeof gate) => g.length === 1, "the gate ran once for this delivery"));
    t.check(
      gate[0],
      satisfies(
        (g: GateRecord | undefined) => g?.kind === "gate" && g.dispatched === false && g.authorId === STRANGER.id && g.pullRequestNumber === pull,
        "the gate refused the stranger's review comment",
      ),
    );

    await new Promise((r) => setTimeout(r, QUIET_MS));
    const activity = activityFor(pull, installation);
    t.log(`activity for pull ${pull} after ${QUIET_MS} ms: ${JSON.stringify(activity)}`);
    t.check(activity, satisfies((a: typeof activity) => a.length === 0, "no turn started, no token was minted and nothing was posted"));
  },
});
