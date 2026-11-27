import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** The webhook secret the harness channel and the evals share. A test string, not a credential. */
export const TEST_WEBHOOK_SECRET = "paper-desk-github-gate-test-secret";
/** A repo that does not exist, so no payload names the real one. */
export const TEST_OWNER = "paper-desk-gate-test";
export const TEST_REPO = "gate-fixture";

/**
 * What the channel did, one JSON line each. The dev server and the eval run as separate processes from the same
 * app directory, so a file under .eve/ (gitignored) is the shared observable; the webhook response is {"ok":true}
 * whether or not a turn starts, because eve dispatches after it answers.
 */
export type GateRecord =
  | { kind: "gate"; deliveryId: string; issueNumber: number | null; pullRequestNumber: number | null; authorId: number | null; dispatched: boolean }
  | { kind: "turn.started"; issueNumber: number | null; pullRequestNumber: number | null }
  | { kind: "api"; method: string; path: string; authorized: boolean; body: string };

export const LOG_PATH = resolve(process.cwd(), ".eve/github-gate/records.jsonl");

export function record(entry: GateRecord): void {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
}

export function readRecords(): (GateRecord & { at: number })[] {
  let text = "";
  try {
    text = readFileSync(LOG_PATH, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}
