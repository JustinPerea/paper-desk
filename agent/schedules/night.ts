import { defineSchedule } from "eve/schedules";
import github from "../channels/github";
import { gh, OWNER, REPO, repoPath } from "../lib/github";

/**
 * Nightly run. A markdown schedule fails the session when a tool needs approval, so this is a handler: it opens
 * one issue for the night as the App, then starts a session on that issue. Approval replies land there.
 * 07:30 New York time, after the digest for the night is committed.
 */
export default defineSchedule({
  cron: "30 7 * * *",
  timezone: "America/New_York",
  async run({ to, waitUntil, appAuth }) {
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const issue = await gh<{ number: number }>("POST", repoPath("/issues"), {
      title: `Night ${date}`,
      body: `Nightly read for ${date}. The agent replies here; a pull request follows for review.`,
    });
    waitUntil(
      to(github, { owner: OWNER, repo: REPO, issueNumber: issue.number }).send(
        `Night ${date}. Run read_night for ${date}, then report and call publish_night as your instructions say.`,
        { auth: appAuth },
      ),
    );
  },
});
