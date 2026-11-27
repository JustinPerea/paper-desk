import { parseArxivHtml } from "../../lib/arxiv-html";
import { FullRecord } from "../../lib/record";
import { checkScript, Script } from "../../lib/script";
import { verifyRecord } from "../../lib/verify";
import { gh, OWNER, REPO, repoPath } from "./github";

async function fileAt(path: string, sha: string): Promise<unknown> {
  const f = await gh<{ content: string }>("GET", repoPath(`/contents/${path}?ref=${sha}`));
  return JSON.parse(Buffer.from(f.content, "base64").toString("utf8"));
}

/**
 * The final check before a night merges, run on the files at the PR's head commit. Returns problems as codes and
 * paths (never the files' own prose, since this text reaches the root model); empty means it may merge.
 */
export async function checkNight(date: string, sha: string): Promise<string[]> {
  const rec = FullRecord.safeParse(await fileAt(`nights/${date}/record.json`, sha));
  if (!rec.success) return rec.error.issues.slice(0, 6).map((i) => `record ${i.path.join(".")}: ${i.code}`);
  const record = rec.data;
  const { arxiv_id, version } = record.paper;
  const res = await fetch(`https://arxiv.org/html/${arxiv_id}${version}`, {
    headers: { "user-agent": `paper-desk (https://github.com/${OWNER}/${REPO})` },
  });
  if (res.status !== 200) return [`arXiv HTML for ${arxiv_id}${version} returned ${res.status}`];
  const paper = parseArxivHtml(await res.text(), { arxivId: arxiv_id, version });
  const v = verifyRecord(record, paper);
  const problems: string[] = [];
  if (!v.paper_match) problems.push("record names a different paper");
  for (const q of v.quotes) if (q.status !== "ok") problems.push(`quote ${q.id}: ${q.status}`);
  for (const n of v.numbers) if (n.status !== "ok") problems.push(`number ${n.id}: ${n.status}`);
  for (const c of v.claims) if (c.status === "no_ok_quote") problems.push(`claim ${c.index}: no_ok_quote`);
  for (const l of v.limits_authors) if (l.status !== "ok") problems.push(`limit ${l.index}: ${l.status}`);
  for (const i of v.numeral_issues) problems.push(`unverified numeral in ${i.field}`);
  if (problems.length) return problems;
  const scr = Script.safeParse(await fileAt(`nights/${date}/script.json`, sha));
  if (!scr.success) return scr.error.issues.slice(0, 6).map((i) => `script ${i.path.join(".")}: ${i.code}`);
  return checkScript(scr.data, record).map((i) => `script${i.beat === undefined ? "" : ` beat ${i.beat}`}: ${i.code}`);
}
