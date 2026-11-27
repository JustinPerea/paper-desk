import { type Candidate, parseArxivRss, selectNew } from "../../lib/arxiv-feed";
import { requireNightRunner } from "./caller";
import { gh, OWNER, REPO, repoPath } from "./github";
import * as core from "./night-core";
import type { PaperRef, PaperText, ScriptCheck } from "./night-core";
import { alreadyRead, CATEGORIES, fetchText, loadPaper, MAX_CANDIDATES, nightState, parsedFor } from "./night-io";

export type { PaperRef, PaperText } from "./night-core";

/**
 * The "use step" functions of read_night. They live apart from the tool so the workflow body imports nothing that
 * pulls in Node built-ins (cheerio, Connect, eve's auth): the body reaches this module only through step calls.
 * The checks themselves are in night-core.ts, shared with the eval harness; these steps add the network reads.
 */

export async function checkRunner(auth: unknown): Promise<void> {
  "use step";
  requireNightRunner(auth as Parameters<typeof requireNightRunner>[0], "read_night");
}

/** Keeps only ids from tonight's list, in the picker's order, and cleans its reasons. */
export async function checkPick(pick: { arxiv_ids: string[]; reasons: string }, candidates: Candidate[]): Promise<{ ranked: string[]; reasons: string }> {
  "use step";
  return core.checkPick(pick, candidates);
}

export async function fetchCandidates(): Promise<Candidate[]> {
  "use step";
  const feed = await fetchText(`https://rss.arxiv.org/rss/${CATEGORIES.join("+")}`);
  if (feed.status !== 200) throw new Error(`arXiv RSS -> ${feed.status}`);
  return selectNew(parseArxivRss(feed.text), await alreadyRead(), MAX_CANDIDATES);
}

export async function fetchPaperText(arxivId: string): Promise<PaperText | null> {
  "use step";
  const loaded = await loadPaper(arxivId);
  if (!loaded) return null;
  return core.paperText(loaded.parsed, {
    arxiv_id: arxivId,
    version: loaded.version,
    url: `https://arxiv.org/abs/${arxivId}${loaded.version}`,
    license: loaded.license,
    read_at: new Date().toISOString(),
  });
}

export async function checkOutput(ref: PaperRef, output: unknown): Promise<{ repair: string | null }> {
  "use step";
  return { repair: core.repairFor(ref, output, await parsedFor(ref)) };
}

export async function finalizeRecord(ref: PaperRef, output: unknown, pickReasons: string): Promise<core.Finalized> {
  "use step";
  return core.finalize(ref, output, pickReasons, await parsedFor(ref));
}

/** Idempotent: a retried step reuses the branch, overwrites the files and finds the open PR. */
export async function openNightPr(
  date: string,
  ref: PaperRef,
  recordJson: string,
  verificationJson: string,
  script: { scriptJson: string | null; codes: string[]; problems: string },
  counts: Record<string, number>,
): Promise<{ number: number; url: string; head_sha: string }> {
  "use step";
  const { scriptJson } = script;
  // The script check's outcome goes into verification.json, so a failed night can be diagnosed from the PR.
  verificationJson =
    JSON.stringify(
      { ...JSON.parse(verificationJson), script: { passed: scriptJson !== null, codes: script.codes, problems: script.problems.slice(0, 4000) } },
      null,
      2,
    ) + "\n";
  const branch = `night/${date}`;
  try {
    await gh("GET", repoPath(`/git/ref/heads/${branch}`));
  } catch (e) {
    if (!String(e).includes("-> 404")) throw e;
    const main = await gh<{ object: { sha: string } }>("GET", repoPath("/git/ref/heads/main"));
    await gh("POST", repoPath("/git/refs"), { ref: `refs/heads/${branch}`, sha: main.object.sha });
  }
  const dir = `nights/${date}`;
  const onBranch = async (): Promise<{ name: string; path: string; sha: string }[]> => {
    try {
      return await gh("GET", repoPath(`/contents/${dir}?ref=${encodeURIComponent(branch)}`));
    } catch (e) {
      if (!String(e).includes("-> 404")) throw e;
      return [];
    }
  };
  let headSha = "";
  const existing = await onBranch();
  const put = async (name: string, content: string, message: string) => {
    const sha = existing.find((f) => f.name === name)?.sha;
    const res = await gh<{ commit: { sha: string } }>("PUT", repoPath(`/contents/${dir}/${name}`), {
      message,
      content: Buffer.from(content).toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    });
    headSha = res.commit.sha;
  };
  await put("record.json", recordJson, `Night ${date}: record for ${ref.arxiv_id}${ref.version}`);
  await put("verification.json", verificationJson, `Night ${date}: verification for ${ref.arxiv_id}${ref.version}`);
  const written = ["record.json", "verification.json"];
  if (scriptJson) {
    await put("script.json", scriptJson, `Night ${date}: script for ${ref.arxiv_id}${ref.version}`);
    written.push("script.json");
  }
  // A rerun for the same date must not carry files from an earlier run (an old script, say) into the merge.
  for (const f of existing.filter((x) => !written.includes(x.name))) {
    const res = await gh<{ commit: { sha: string } }>("DELETE", repoPath(`/contents/${f.path}`), {
      message: `Night ${date}: remove ${f.name} from an earlier run`,
      sha: f.sha,
      branch,
    });
    headSha = res.commit.sha;
  }
  const title = `Night ${date}: ${ref.arxiv_id}${ref.version}`;
  const body = [
    `Paper: ${ref.url}`,
    `License: ${ref.license ?? "not stated"}`,
    "",
    `Verified: ${counts.quotes} quotes, ${counts.claims} claims, ${counts.numbers} numbers, ${counts.limits} limits. Dropped: ${counts.dropped}.`,
    scriptJson
      ? "Script: passed its check (every number traces to a verified number)."
      : `Script: none, it failed its check (${script.codes.join(", ")}). This PR can't merge.`,
    "The picker's reasons, every dropped item and the script check's problems are in verification.json.",
  ].join("\n");
  const open = await gh<{ number: number }[]>("GET", repoPath(`/pulls?state=open&head=${OWNER}:${encodeURIComponent(branch)}`));
  let number = open[0]?.number;
  if (number === undefined) {
    number = (await gh<{ number: number }>("POST", repoPath("/pulls"), { title, head: branch, base: "main", body })).number;
  } else {
    await gh("PATCH", repoPath(`/pulls/${number}`), { title, body });
  }
  // The sha from our own last write, not a read of the PR, which can lag behind it for a moment.
  return { number, url: `https://github.com/${OWNER}/${REPO}/pull/${number}`, head_sha: headSha };
}

/**
 * Claims tonight for one scheduled run by creating its branch at main's head. Creating a ref is atomic on GitHub, so
 * a second run for the same date gets a 422 and stops instead of racing the first on the same branch. Returns the
 * sha the branch was created at, or null when the branch already exists.
 */
export async function claimNight(date: string): Promise<string | null> {
  "use step";
  const main = await gh<{ object: { sha: string } }>("GET", repoPath("/git/ref/heads/main"));
  try {
    await gh("POST", repoPath("/git/refs"), { ref: `refs/heads/night/${date}`, sha: main.object.sha });
    return main.object.sha;
  } catch (e) {
    if (String(e).includes("-> 422")) return null;
    throw e;
  }
}

/** Releases a claim when the run ends without a PR: deletes the branch only if nothing was written to it. */
export async function releaseNight(date: string, claimedSha: string): Promise<void> {
  "use step";
  const ref = await gh<{ object: { sha: string } }>("GET", repoPath(`/git/ref/heads/night/${date}`)).catch(() => null);
  if (ref?.object.sha === claimedSha) await gh("DELETE", repoPath(`/git/refs/heads/night/${date}`));
}

/** Whether tonight is already published, and any open PR for it. Stops reruns from spending the model key twice. */
export async function checkNight(date: string): Promise<{ published: boolean; open_pr: number | null }> {
  "use step";
  return nightState(date);
}

/**
 * The scriptwriter's input: the verified record without the reader's own inferences (only claims the authors make),
 * and each number with `spoken`, the exact words the narrator will say for it, or null when it may only be shown.
 */
export async function scriptBrief(recordJson: string): Promise<string> {
  "use step";
  return core.scriptBrief(recordJson);
}

/** Checks the scriptwriter's output against the verified record. Problems go back to the scriptwriter, not the root. */
export async function checkScriptOutput(recordJson: string, output: unknown): Promise<ScriptCheck> {
  "use step";
  return core.checkScriptOutput(recordJson, output);
}
