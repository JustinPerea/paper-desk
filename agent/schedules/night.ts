import { defineSchedule } from "eve/schedules";
import github from "../channels/github";
import { gh, OWNER, REPO, repoPath } from "../lib/github";
import { nightMessage } from "../lib/prompts";

/**
 * Nightly run. A handler, so it can open one issue for the night as the App and start a session on it; the
 * agent's report lands on that issue and Justin can reply there.
 * 07:30 New York time, after arXiv's RSS feeds update (midnight ET).
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
        nightMessage(date),
        { auth: appAuth },
      ),
    );
  },
});
