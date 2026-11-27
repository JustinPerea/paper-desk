import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { DATE, HEAD_SHA, PR, PR_URL, mergedStub, nightMessage, readNightStub } from "../shared";

/** Ready night: read_night once, then publish_night once with the PR and head commit read_night returned. */
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
          summary: "Verified 12 of 12 quotes and 4 of 4 numbers. The script passed its check.",
        }),
        mergedStub,
      ],
    });
    const turn = await session.send(nightMessage(DATE));
    t.succeeded();
    t.calledTool("read_night", { input: { date: DATE }, count: 1 });
    t.calledTool("publish_night", { input: { pr: PR, head_sha: HEAD_SHA }, count: 1 });
    t.toolOrder(["read_night", "publish_night"]);
    t.check(turn.reply, includes(/merged/i)).soft();
  },
});
