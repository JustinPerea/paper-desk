import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGitHubAuth, type GitHubComment, type GitHubInboundContext, type GitHubUser } from "eve/channels/github";
import { JUSTIN_GITHUB_ID, justinOnlyComments } from "../agent/lib/comment-gate";

const justin: GitHubUser = { id: JUSTIN_GITHUB_ID, login: "JustinPerea", type: "User", htmlUrl: undefined, url: undefined };

/** The inbound context eve builds for an issue comment; only the fields defaultGitHubAuth reads matter. */
function ctxFor(sender: GitHubUser): GitHubInboundContext {
  return {
    conversation: { issueNumber: 7, kind: "issue", pullRequestNumber: null },
    delivery: { event: "issue_comment", id: "delivery-1" },
    github: { installationId: 42 },
    repository: { fullName: "JustinPerea/paper-desk", id: 1, name: "paper-desk", owner: "JustinPerea", private: false },
    sender,
  } as unknown as GitHubInboundContext;
}

function comment(author: GitHubUser | undefined): GitHubComment {
  return { author, body: "@paper-desk read tonight's paper", id: 1, raw: {} } as unknown as GitHubComment;
}

test("Justin's comment starts a turn with the default GitHub auth", () => {
  const ctx = ctxFor(justin);
  const result = justinOnlyComments(ctx, comment(justin));
  assert.deepEqual(result, { auth: defaultGitHubAuth(ctx) });
  assert.equal(result?.auth?.principalId, `github:${JUSTIN_GITHUB_ID}`);
  assert.equal(result?.auth?.authenticator, "github-webhook");
});

test("a stranger's comment, bot mention and all, starts nothing", () => {
  const stranger: GitHubUser = { id: 1, login: "octocat", type: "User", htmlUrl: undefined, url: undefined };
  assert.equal(justinOnlyComments(ctxFor(stranger), comment(stranger)), null);
});

test("a comment with no author starts nothing", () => {
  assert.equal(justinOnlyComments(ctxFor(justin), comment(undefined)), null);
});

test("a bot's comment starts nothing, including the App's own", () => {
  const bot: GitHubUser = { id: 999, login: "paper-desk[bot]", type: "Bot", htmlUrl: undefined, url: undefined };
  assert.equal(justinOnlyComments(ctxFor(bot), comment(bot)), null);
});

test("Justin's login on another account's id starts nothing (the gate keys on the id, not the login)", () => {
  const spoof: GitHubUser = { id: JUSTIN_GITHUB_ID + 1, login: "JustinPerea", type: "User", htmlUrl: undefined, url: undefined };
  assert.equal(justinOnlyComments(ctxFor(spoof), comment(spoof)), null);
});

test("lib/github.ts re-exports the same id", async () => {
  const github = await import("../agent/lib/github");
  assert.equal(github.JUSTIN_GITHUB_ID, JUSTIN_GITHUB_ID);
  assert.equal(github.JUSTIN_PRINCIPAL_ID, `github:${JUSTIN_GITHUB_ID}`);
});
