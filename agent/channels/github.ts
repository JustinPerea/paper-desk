import { githubChannel } from "eve/channels/github";
import { justinOnlyComments } from "../lib/comment-gate";
import { credentials } from "../lib/github";

/**
 * Only Justin's comments start or continue a turn (see lib/comment-gate.ts, which harness/github-gate also runs).
 * Issues, PRs and CI events dispatch nothing (no onIssue, onPullRequest or CI hooks).
 */
export default githubChannel({
  credentials,
  onComment: justinOnlyComments,
});
