import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { DATE, nightMessage } from "../shared";

/**
 * No read_night stub: the real tool runs for an eve-channel local-dev caller. Its first step, checkRunner,
 * throws because only the schedule or Justin's GitHub comment may run it (agent/lib/caller.ts), before any network
 * or GitHub call. publish_night's first line is the same check, and its stub throws as a second guard, so nothing
 * here can write to GitHub even if the agent calls it. get_night is stubbed so the eval makes no network call.
 */
export default defineEval({
  timeoutMs: 180_000,
  async test(t) {
    const session = await t.session({
      stubs: [
        { id: "publish-guard", tool: "publish_night", outcome: { throw: { message: "eval guard: publish_night must not run" } } },
        { id: "get", tool: "get_night", outcome: { response: { date: DATE, found: false, url: "", record: null, script: null } } },
      ],
    });
    const turn = await session.send(nightMessage(DATE));
    t.calledTool("read_night", { status: "failed", count: (n) => n >= 1 });
    // The refusal must come from checkRunner, not from a later step failing for lack of credentials or network.
    t.check(JSON.stringify(turn.events), includes("read_night runs only in the nightly session or for Justin")).label("refused by checkRunner");
    t.notCalledTool("publish_night");
  },
});
