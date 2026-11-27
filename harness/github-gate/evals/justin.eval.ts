import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import type { GateRecord } from "../agent/lib/record";
import { equals, satisfies } from "eve/evals/expect";
import { activityFor, freshInstallation, freshIssue, issueComment, JUSTIN, STRANGER, waitFor, webhookInit } from "./webhook";

const QUIET_MS = 15_000;

/**
 * Positive control: the same payload from Justin's id starts a turn, and the mock root's reply (carrying the
 * nonce) reaches the fake GitHub API. Then a stranger comments on that live thread and adds nothing to it.
 */
export default defineEval({
  timeoutMs: 180_000,
  async test(t) {
    const issue = freshIssue();
    const installation = freshInstallation();
    const nonce = randomUUID();
    const sentAt = Date.now();
    const init = webhookInit(JSON.stringify(issueComment(JUSTIN, issue, nonce, installation)));
    const res = await t.target.fetch("/eve/v1/github", init);
    t.check(res.status, equals(200));
    t.check(await res.json(), equals({ ok: true }));

    const gate = await waitFor((r) => r.kind === "gate" && r.deliveryId === init.deliveryId, 30_000);
    t.check(gate[0], satisfies((g: GateRecord | undefined) => g?.kind === "gate" && g.dispatched === true && g.authorId === JUSTIN.id, "the gate admitted Justin"));

    const started = await waitFor((r) => r.kind === "turn.started" && r.issueNumber === issue, 60_000);
    t.check(started, satisfies((s: typeof started) => s.length === 1, "one turn started"));

    const reply = await waitFor((r) => r.kind === "api" && r.method === "POST" && r.path.endsWith(`/issues/${issue}/comments`), 60_000);
    t.check(reply[0], satisfies((r: GateRecord | undefined) => r?.kind === "api" && r.authorized && r.body.includes(nonce), "the reply was posted with a token and carries the nonce"));
    const token = await waitFor((r) => r.kind === "api" && r.path === `/app/installations/${installation}/access_tokens`, 5_000);
    t.check(token, satisfies((tk: typeof token) => tk.length === 1, "this installation's token came from the fake API, once"));
    const startedAt = activityFor(issue, installation).find((r) => r.kind === "turn.started")?.at;
    t.log(`turn started ${startedAt === undefined ? "?" : startedAt - sentAt} ms after the webhook`);

    // A stranger on the live thread: refused by the same gate, and no second turn or reply follows.
    const before = activityFor(issue, installation).length;
    const follow = webhookInit(JSON.stringify(issueComment(STRANGER, issue, randomUUID(), installation)));
    const res2 = await t.target.fetch("/eve/v1/github", follow);
    t.check(await res2.json(), equals({ ok: true }));
    const gate2 = await waitFor((r) => r.kind === "gate" && r.deliveryId === follow.deliveryId, 30_000);
    t.check(gate2[0], satisfies((g: GateRecord | undefined) => g?.kind === "gate" && g.dispatched === false, "the gate refused the stranger on Justin's thread"));
    await new Promise((r) => setTimeout(r, QUIET_MS));
    const after = activityFor(issue, installation);
    t.log(`activity for issue ${issue}: ${JSON.stringify(after.map((a) => ({ kind: a.kind, path: "path" in a ? a.path : undefined })))}`);
    t.check(after.length, equals(before));
  },
});
