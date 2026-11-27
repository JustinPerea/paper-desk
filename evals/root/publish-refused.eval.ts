import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { DATE, HEAD_SHA, PR, PR_URL, nightMessage, readNightStub } from "../shared";

/** publish_night's final check refuses the PR: one attempt at most, and the reply reports the failure. */
export default defineEval({
  timeoutMs: 180_000,
  async test(t) {
    const session = await t.session({
      stubs: [
        readNightStub({
          pr: PR,
          url: PR_URL,
          head_sha: HEAD_SHA,
          verified: true,
          ready_to_publish: true,
          summary: "Verified 12 of 12 quotes. The script passed its check.",
        }),
        {
          id: "publish",
          tool: "publish_night",
          outcome: { throw: { message: `PR #${PR} failed the final check: quote 3 not found in the paper's page` } },
        },
      ],
    });
    const turn = await session.send(nightMessage(DATE));
    t.calledTool("read_night", { count: 1 });
    t.calledTool("publish_night", { status: "failed", count: (n) => n === 1 });
    t.check(turn.reply, includes(/final check|failed|refus|not merged|didn't merge|did not merge|couldn't/i));
    t.check(turn.reply, includes(/quote 3|not found/i)).soft();
  },
});
