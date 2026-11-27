import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { DATE, HEAD_SHA, PR, PR_URL, mergedStub, nightMessage, readNightStub } from "../shared";

/** The record verified but the script failed its check: no merge, and the reply says the PR stays open. */
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
          ready_to_publish: false,
          summary: "Verified 12 of 12 quotes. The script failed its check after two repair rounds.",
        }),
        mergedStub,
      ],
    });
    const turn = await session.send(nightMessage(DATE));
    t.succeeded();
    t.calledTool("read_night", { count: 1 });
    t.notCalledTool("publish_night");
    t.check(turn.reply, includes(/(stays|remains|left|still)[^.]*open|open[^.]*(for review|until)/i));
  },
});
