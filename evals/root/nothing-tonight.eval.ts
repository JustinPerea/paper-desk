import { defineEval } from "eve/evals";
import { DATE, mergedStub, nightMessage, readNightStub } from "../shared";

/** No paper tonight (no PR, nothing verified): the agent reports it and never calls publish_night. */
export default defineEval({
  timeoutMs: 180_000,
  async test(t) {
    const session = await t.session({
      stubs: [
        readNightStub({
          pr: null,
          url: null,
          head_sha: null,
          verified: false,
          ready_to_publish: false,
          summary: "arXiv's feed has no new, unread papers tonight.",
        }),
        mergedStub,
      ],
    });
    await session.send(nightMessage(DATE));
    t.succeeded();
    t.calledTool("read_night", { count: 1 });
    t.notCalledTool("publish_night");
  },
});
