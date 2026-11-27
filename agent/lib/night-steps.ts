import { type Candidate, parseArxivRss, selectNew, validatePick } from "../../lib/arxiv-feed";
import { paperForReader, repairMessage } from "../../lib/reader";
import { cleanText } from "../../lib/sanitize";
import { applyVerification, verifyRecord } from "../../lib/verify";
import { requireNightRunner } from "./caller";
import { gh, OWNER, repoPath } from "./github";
import { alreadyRead, buildRecord, CATEGORIES, fetchText, loadPaper, MAX_CANDIDATES, parsedFor } from "./night-io";

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

export async function finalizeRecord(ref: PaperRef, output: unknown) {
  "use step";
  const paper = await parsedFor(ref);
  let record;
  try {
    record = buildRecord(output, paper, ref);
  } catch (e) {
    return { ok: false as const, error: String(e).slice(0, 300) };
  }
  const result = verifyRecord(record, paper);
  if (!result.paper_match) return { ok: false as const, error: "the record names a different paper" };
  const { record: kept, dropped, reported } = applyVerification(record, result);
  const counts = {
    quotes: kept.quotes.length,
    claims: kept.claims.length,
    numbers: kept.numbers.length,
    limits: kept.limits_authors.length,
    dropped: dropped.length,
    numeral_issues_left: reported.length,
  };
  return {
    ok: true as const,
    recordJson: JSON.stringify(kept, null, 2) + "\n",
    verificationJson: JSON.stringify({ arxiv_id: ref.arxiv_id, version: ref.version, counts, dropped, reported }, null, 2) + "\n",
    counts,
  };
}

/** Idempotent: a retried step reuses the branch, overwrites the files and finds the open PR. */
export async function openNightPr(
  date: string,
  ref: PaperRef,
  recordJson: string,
  verificationJson: string,
  pickReasons: string,
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
  const put = async (path: string, content: string, message: string) => {
    let sha: string | undefined;
    try {
      sha = (await gh<{ sha: string }>("GET", repoPath(`/contents/${path}?ref=${encodeURIComponent(branch)}`))).sha;
    } catch (e) {
      if (!String(e).includes("-> 404")) throw e;
    }
    await gh("PUT", repoPath(`/contents/${path}`), { message, content: Buffer.from(content).toString("base64"), branch, ...(sha ? { sha } : {}) });
  };
  await put(`nights/${date}/record.json`, recordJson, `Night ${date}: record for ${ref.arxiv_id}${ref.version}`);
  await put(`nights/${date}/verification.json`, verificationJson, `Night ${date}: verification for ${ref.arxiv_id}${ref.version}`);
  const open = await gh<{ number: number }[]>("GET", repoPath(`/pulls?state=open&head=${OWNER}:${encodeURIComponent(branch)}`));
  let number = open[0]?.number;
  if (number === undefined) {
    const created = await gh<{ number: number }>("POST", repoPath("/pulls"), {
      title: `Night ${date}: ${ref.arxiv_id}${ref.version}`,
      head: branch,
      base: "main",
      body: [
        `Paper: ${ref.url}`,
        `License: ${ref.license ?? "not stated"}`,
        "",
        `Verified: ${counts.quotes} quotes, ${counts.claims} claims, ${counts.numbers} numbers, ${counts.limits} limits. Dropped: ${counts.dropped} (see verification.json).`,
        "",
        `Why this paper (the picker's words): ${pickReasons}`,
      ].join("\n"),
    });
    number = created.number;
  }
  const pull = await gh<{ html_url: string; head: { sha: string } }>("GET", repoPath(`/pulls/${number}`));
  return { number, url: pull.html_url, head_sha: pull.head.sha };
}
