import { type Candidate, parseArxivRss, selectNew, validatePick } from "../../lib/arxiv-feed";
import { paperForReader, repairMessage } from "../../lib/reader";
import { ScriptOutput } from "../../lib/script-schema";
import { cleanText } from "../../lib/sanitize";
import { applyVerification, stripReported, verifyRecord } from "../../lib/verify";
import { assembleScript, checkScript } from "../../lib/script";
import type { FullRecord } from "../../lib/record";
import { requireNightRunner } from "./caller";
import { gh, OWNER, REPO, repoPath } from "./github";
import { alreadyRead, buildRecord, CATEGORIES, errorShape, fetchText, loadPaper, MAX_CANDIDATES, nightState, parsedFor } from "./night-io";

/**
 * The "use step" functions of read_night. They live apart from the tool so the workflow body imports nothing that
 * pulls in Node built-ins (cheerio, Connect, eve's auth): the body reaches this module only through step calls.
 */


export async function checkRunner(auth: unknown): Promise<void> {
  "use step";
  requireNightRunner(auth as Parameters<typeof requireNightRunner>[0], "read_night");
}

/** Keeps only ids from tonight's list, in the picker's order, and cleans its reasons. */
export async function checkPick(pick: { arxiv_ids: string[]; reasons: string }, candidates: Candidate[]): Promise<{ ranked: string[]; reasons: string }> {
  "use step";
  return { ranked: validatePick(pick, candidates).map((c) => c.arxiv_id), reasons: cleanText(pick.reasons, 600) ?? "" };
}

export interface PaperRef {
  arxiv_id: string;
  version: string;
  url: string;
  license: string | null;
  read_at: string;
}
export interface PaperText {
  ref: PaperRef;
  text: string;
  truncated: boolean;
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
  const { text, truncated } = paperForReader(loaded.parsed);
  return {
    ref: {
      arxiv_id: arxivId,
      version: loaded.version,
      url: `https://arxiv.org/abs/${arxivId}${loaded.version}`,
      license: loaded.license,
      read_at: new Date().toISOString(),
    },
    text,
    truncated,
  };
}



export async function checkOutput(ref: PaperRef, output: unknown): Promise<{ repair: string | null }> {
  "use step";
  const paper = await parsedFor(ref);
  let record;
  try {
    record = buildRecord(output, paper, ref);
  } catch (e) {
    return { repair: `Your record was malformed: ${String(e).slice(0, 2000)}\nReturn the full corrected record.` };
  }
  return { repair: repairMessage(verifyRecord(record, paper), record) };
}

export async function finalizeRecord(ref: PaperRef, output: unknown, pickReasons: string) {
  "use step";
  const paper = await parsedFor(ref);
  let record;
  try {
    record = buildRecord(output, paper, ref);
  } catch (e) {
    // Only codes and paths: a zod message can carry the reader's own strings, and this text reaches the root model.
    return { ok: false as const, error: errorShape(e) };
  }
  const result = verifyRecord(record, paper);
  if (!result.paper_match) return { ok: false as const, error: "the record names a different paper" };
  const applied = applyVerification(record, result);
  const { dropped, reported } = applied;
  // Sentences in single-text fields that carry an unverified numeral are cut, so the record re-verifies cleanly
  // in publish_night.
  const kept = stripReported(applied.record, reported);
  const recheck = verifyRecord(kept, paper);
  if (!recheck.all_ok) return { ok: false as const, error: "the record did not re-verify after dropping failures" };
  const counts = {
    quotes: kept.quotes.length,
    claims: kept.claims.length,
    numbers: kept.numbers.length,
    limits: kept.limits_authors.length,
    dropped: dropped.length,
    sentences_cut: reported.length,
  };
  return {
    ok: true as const,
    recordJson: JSON.stringify(kept, null, 2) + "\n",
    verificationJson:
      JSON.stringify({ arxiv_id: ref.arxiv_id, version: ref.version, counts, dropped, reported, pick_reasons: pickReasons }, null, 2) + "\n",
    counts,
  };
}

/** Idempotent: a retried step reuses the branch, overwrites the files and finds the open PR. */
export async function openNightPr(
  date: string,
  ref: PaperRef,
  recordJson: string,
  verificationJson: string,
  scriptJson: string | null,
  counts: Record<string, number>,
): Promise<{ number: number; url: string; head_sha: string }> {
  "use step";
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
    scriptJson ? "Script: passed its check (every number traces to a verified number)." : "Script: none, it failed its check. This PR can't merge.",
    "The picker's reasons and every dropped item are in verification.json.",
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

/** Whether tonight is already published, and any open PR for it. Stops reruns from spending the model key twice. */
export async function checkNight(date: string): Promise<{ published: boolean; open_pr: number | null }> {
  "use step";
  return nightState(date);
}

/** Checks the scriptwriter's output against the verified record. Problems go back to the scriptwriter, not the root. */
export async function checkScriptOutput(recordJson: string, output: unknown): Promise<{ ok: boolean; problems: string; codes: string[]; scriptJson: string | null }> {
  "use step";
  const record = JSON.parse(recordJson) as FullRecord;
  let script;
  try {
    script = assembleScript(ScriptOutput.parse(output), record);
  } catch (e) {
    return { ok: false, problems: `The script was malformed: ${String(e).slice(0, 1500)}`, codes: ["malformed"], scriptJson: null };
  }
  const issues = checkScript(script, record);
  if (issues.length === 0) return { ok: true, problems: "", codes: [], scriptJson: JSON.stringify(script, null, 2) + "\n" };
  return {
    ok: false,
    problems: issues.map((i) => `- ${i.beat === undefined ? "" : `beat ${i.beat}: `}${i.message}`).join("\n"),
    codes: [...new Set(issues.map((i) => i.code))],
    scriptJson: null,
  };
}
