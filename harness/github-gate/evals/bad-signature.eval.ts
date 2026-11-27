import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";
import { readRecords } from "../agent/lib/record";
import { freshInstallation, freshIssue, issueComment, JUSTIN, webhookInit } from "./webhook";

/**
 * A webhook signed with the wrong secret is refused before parsing, even when it claims to be Justin's:
 * 401, and the gate never sees it. A webhook with no signature header gets the same.
 */
export default defineEval({
  timeoutMs: 60_000,
  async test(t) {
    const body = JSON.stringify(issueComment(JUSTIN, freshIssue(), randomUUID(), freshInstallation()));
    const forged = webhookInit(body, "not-the-secret");
    const res = await t.target.fetch("/eve/v1/github", forged);
    t.check(res.status, equals(401));

    const unsigned = webhookInit(body);
    delete (unsigned.headers as Record<string, string>)["x-hub-signature-256"];
    const res2 = await t.target.fetch("/eve/v1/github", unsigned);
    t.check(res2.status, equals(401));

    await new Promise((r) => setTimeout(r, 3_000));
    const seen = readRecords().filter((r) => r.kind === "gate" && (r.deliveryId === forged.deliveryId || r.deliveryId === unsigned.deliveryId));
    t.check(seen, satisfies((s: typeof seen) => s.length === 0, "the gate never ran for an unverified webhook"));
  },
});
