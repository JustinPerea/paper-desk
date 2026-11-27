import { defaultGitHubAuth, type GitHubComment, type GitHubInboundContext, type GitHubInboundResult } from "eve/channels/github";

/** Justin's GitHub user id. The only account whose comments start a turn. */
export const JUSTIN_GITHUB_ID = 72950107;

/**
 * The GitHub channel's onComment gate. The repo is public, so the default gate (any comment containing the
 * bot token starts a turn) would let anyone spend Justin's model key and feed the agent text. Only Justin's
 * comments start or continue a turn; everyone else gets null, which acknowledges the webhook and dispatches nothing.
 * It lives here, apart from lib/github.ts, so tests and the harness can import it without Vercel Connect.
 */
export function justinOnlyComments(ctx: GitHubInboundContext, comment: GitHubComment): GitHubInboundResult {
  return comment.author?.id === JUSTIN_GITHUB_ID ? { auth: defaultGitHubAuth(ctx) } : null;
}
