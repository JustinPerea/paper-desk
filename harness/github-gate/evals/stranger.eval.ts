import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import type { GateRecord } from "../agent/lib/record";
import { equals, satisfies } from "eve/evals/expect";
import { activityFor, freshInstallation, freshIssue, issueComment, STRANGER, waitFor, webhookInit } from "./webhook";

/** How long to watch for a turn after the gate said no. A dispatched turn shows up in about a second here. */
const QUIET_MS = 15_000;

/**
 * A stranger's correctly signed comment, bot mention included, reaches the gate and starts nothing: no turn,
 * no installation token, no reply.
 */
export default defineEval({
  timeoutMs: 120_000,
  async test(t) {
    const issue = freshIssue();
    const installation = freshInstallation();
    const init = webhookInit(JSON.stringify(issueComment(STRANGER, issue, randomUUID(), installation)));
    const res = await t.target.fetch("/eve/v1/github", init);
    t.check(res.status, equals(200));
    // {"ok":true} without "ignored" means eve parsed it as a comment it would dispatch on, not a dropped event.
    t.check(await res.json(), equals({ ok: true }));

    const gate = await waitFor((r) => r.kind === "gate" && r.deliveryId === init.deliveryId, 30_000);
    t.check(gate, satisfies((g: typeof gate) => g.length === 1, "the gate ran once for this delivery"));
    t.check(gate[0], satisfies((g: GateRecord | undefined) => g?.kind === "gate" && g.dispatched === false && g.authorId === STRANGER.id, "the gate refused the stranger"));

    await new Promise((r) => setTimeout(r, QUIET_MS));
    const activity = activityFor(issue, installation);
    t.log(`activity for issue ${issue} after ${QUIET_MS} ms: ${JSON.stringify(activity)}`);
    t.check(activity, satisfies((a: typeof activity) => a.length === 0, "no turn started, no token was minted and nothing was posted"));
  },
});
