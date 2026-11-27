import { defineEval } from "eve/evals";
import { DATE, HEAD_SHA, PR, PR_URL, mergedStub, nightMessage, readNightStub } from "../shared";

/**
 * Justin's comment on the night's issue names a paper. In production his comment continues the session the schedule
 * started on that issue, and the GitHub channel sends only the comment text plus a <github_context> block (no date),
 * so the date has to come from the night's first message. The eval replays that: the schedule's turn, then the comment.
 */
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
          summary: "Verified 9 of 9 quotes. The script passed its check.",
        }),
        mergedStub,
      ],
    });
    await session.send(nightMessage(DATE));
    await session.send("read 2611.27106", {
      clientContext: [
        ["<github_context>", "repository: JustinPerea/paper-desk", "issue_number: 99", "sender: JustinPerea", "sender_type: User", "</github_context>"].join("\n"),
      ],
    });
    t.succeeded();
    t.calledTool("read_night", { input: { arxiv_id: "2611.27106", date: DATE }, count: 1 });
  },
});
