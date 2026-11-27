import { createHmac, randomInt, randomUUID } from "node:crypto";
import { readRecords, TEST_OWNER, TEST_REPO, TEST_WEBHOOK_SECRET, type GateRecord } from "../agent/lib/record";

export const JUSTIN = { id: 72950107, login: "JustinPerea", type: "User" };
/** An ordinary user account: type User and a normal login, so eve's own bot filter doesn't drop it before the gate. */
export const STRANGER = { id: 583231, login: "octocat", type: "User" };

/**
 * A fresh issue number and installation id per case, so each case is its own conversation and its own token
 * request, and log lines from other cases or earlier runs never match.
 */
export const freshIssue = () => randomInt(100_000, 2_000_000_000);
export const freshInstallation = () => randomInt(100_000, 2_000_000_000);

/** An issue_comment "created" payload as GitHub sends it. Only the commenter differs between cases. */
export function issueComment(user: typeof JUSTIN, issueNumber: number, nonce: string, installationId: number) {
  return {
    action: "created",
    issue: { number: issueNumber, title: "Gate fixture", user: JUSTIN },
    comment: {
      id: randomInt(1, 2_000_000_000),
      body: `@paper-desk read tonight's paper ${nonce}`,
      user,
      html_url: `https://github.com/${TEST_OWNER}/${TEST_REPO}/issues/${issueNumber}#issuecomment-1`,
    },
    repository: { id: 1_000_001, name: TEST_REPO, full_name: `${TEST_OWNER}/${TEST_REPO}`, owner: { login: TEST_OWNER }, private: false },
    sender: user,
    installation: { id: installationId },
  };
}

/** A pull_request_review_comment "created" payload: a comment on a line of a PR's diff, which takes the same gate. */
export function reviewComment(user: typeof JUSTIN, pullNumber: number, nonce: string, installationId: number) {
  const repo = { id: 1_000_001, name: TEST_REPO, full_name: `${TEST_OWNER}/${TEST_REPO}`, owner: { login: TEST_OWNER }, private: false, default_branch: "main" };
  return {
    action: "created",
    pull_request: {
      number: pullNumber,
      title: "Gate fixture PR",
      user: JUSTIN,
      head: { ref: "night/2026-11-27", sha: "a".repeat(40), repo },
      base: { ref: "main", sha: "b".repeat(40), repo },
    },
    comment: {
      id: randomInt(1, 2_000_000_000),
      body: `@paper-desk merge this ${nonce}`,
      user,
      path: "nights/2026-11-27/record.json",
      html_url: `https://github.com/${TEST_OWNER}/${TEST_REPO}/pull/${pullNumber}#discussion_r1`,
    },
    repository: repo,
    sender: user,
    installation: { id: installationId },
  };
}

/** Headers GitHub sends with a webhook. The signature is HMAC-SHA256 of the exact body with the webhook secret. */
export function webhookInit(body: string, secret = TEST_WEBHOOK_SECRET, event = "issue_comment"): RequestInit & { deliveryId: string } {
  const deliveryId = randomUUID();
  return {
    deliveryId,
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
  };
}

/** Polls the harness log until `found` matches or the time runs out; returns what matched. */
export async function waitFor(found: (r: GateRecord) => boolean, timeoutMs: number): Promise<GateRecord[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hits = readRecords().filter(found);
    if (hits.length > 0 || Date.now() > deadline) return hits;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Everything the channel did for one case: turn starts and GitHub calls naming its issue or its installation. */
export function activityFor(issueNumber: number, installationId: number) {
  return readRecords().filter(
    (r) =>
      (r.kind === "turn.started" && (r.issueNumber === issueNumber || r.pullRequestNumber === issueNumber)) ||
      (r.kind === "api" && (r.path.includes(`/issues/${issueNumber}/`) || r.path.includes(`/pulls/${issueNumber}`) || r.path.includes(`/installations/${installationId}/`))),
  );
}
