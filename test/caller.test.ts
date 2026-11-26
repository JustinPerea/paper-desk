import { test } from "node:test";
import assert from "node:assert/strict";
import { isNightRunner } from "../agent/lib/caller";

test("the nightly schedule's app identity may run the writing tools", () => {
  assert.equal(isNightRunner({ authenticator: "app", principalId: "eve:app", principalType: "runtime" } as never), true);
});

test("Justin through the GitHub channel may run them", () => {
  assert.equal(isNightRunner({ authenticator: "github-webhook", principalId: "github:72950107" }), true);
});

test("anyone else may not: other GitHub users, a spoofed id from another authenticator, anonymous MCP callers", () => {
  assert.equal(isNightRunner({ authenticator: "github-webhook", principalId: "github:1" }), false);
  assert.equal(isNightRunner({ authenticator: "none", principalId: "github:72950107" }), false);
  assert.equal(isNightRunner({ authenticator: "none", principalId: "anonymous" }), false);
  assert.equal(isNightRunner(null), false);
  assert.equal(isNightRunner(undefined), false);
});
