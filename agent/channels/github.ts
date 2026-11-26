import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import { credentials, JUSTIN_GITHUB_ID } from "../lib/github";

/**
 * The repo is public, so the default gate (any comment containing the bot token starts a turn) would let
 * anyone spend Justin's model key and feed the agent text. Only Justin's comments start or continue a turn.
 * Issues, PRs and CI events dispatch nothing (no onIssue, onPullRequest or CI hooks).
 */
export default githubChannel({
  credentials,
  onComment: (ctx, comment) => (comment.author?.id === JUSTIN_GITHUB_ID ? { auth: defaultGitHubAuth(ctx) } : null),
});
