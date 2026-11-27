import type { ToolStub } from "eve/evals";

/** The message the nightly schedule sends, imported from production so the evals drive the real prompt. */
export { nightMessage } from "../agent/lib/prompts";

export const DATE = "2026-11-27";
export const PR = 77;
export const HEAD_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
export const PR_URL = "https://github.com/example/paper-desk/pull/77";

/** What publish_night returns when it merges. */
export const mergedStub = {
  id: "publish",
  tool: "publish_night",
  outcome: { response: { merged: true, sha: "0123456789abcdef0123456789abcdef01234567" } },
} satisfies ToolStub;

export function readNightStub(response: Record<string, string | number | boolean | null>): ToolStub {
  return { id: "read", tool: "read_night", outcome: { response } };
}

/** Every publish_night call the model made, as {pr, head_sha} inputs. */
export function publishInputs(calls: readonly { name: string; input: unknown }[]) {
  return calls.filter((c) => c.name === "publish_night").map((c) => c.input as { pr?: number; head_sha?: string });
}
