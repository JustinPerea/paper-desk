import { defineTool } from "eve/tools";
import { z } from "zod";
import { gh, NIGHT_BRANCH, repoPath } from "../lib/github";

/**
 * SPIKE STUB (piece 2). Calls no model: it writes a fixed placeholder record to a night branch and opens a pull
 * request, so the schedule -> issue -> PR -> merge path can be tested cheaply. Piece 3 replaces the
 * body with the real workflow (candidates, fetch and parse, reader, verifier, scriptwriter).
 */
export default defineTool({
  description: "Read tonight's paper and open a pull request with the verified record. Returns the PR number and head commit.",
  inputSchema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  async execute({ date }) {
    const branch = `night/${date}`;
    if (!NIGHT_BRANCH.test(branch)) throw new Error("bad date");
    const main = await gh<{ object: { sha: string } }>("GET", repoPath("/git/ref/heads/main"));
    await gh("POST", repoPath("/git/refs"), { ref: `refs/heads/${branch}`, sha: main.object.sha });
    const record = { spike: true, date, note: "Placeholder written by the piece 2 spike. No paper was read." };
    await gh("PUT", repoPath(`/contents/nights/${date}/record.json`), {
      message: `Night ${date}: placeholder record (spike)`,
      content: Buffer.from(JSON.stringify(record, null, 2) + "\n").toString("base64"),
      branch,
    });
    const pr = await gh<{ number: number; html_url: string; head: { sha: string } }>("POST", repoPath("/pulls"), {
      title: `Night ${date} (spike)`,
      head: branch,
      base: "main",
      body: "Spike pull request: placeholder record, no paper read. Merged automatically if the checks pass.",
    });
    // The spike reports verified: true so the merge path runs; the PR title, body and record all say "spike".
    return {
      pr: pr.number,
      url: pr.html_url,
      head_sha: pr.head.sha,
      verified: true,
      summary: "Spike test: a placeholder record with no paper, marked verified so the merge path can be tested.",
    };
  },
});
