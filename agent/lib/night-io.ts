import { parseArxivHtml } from "../../lib/arxiv-html";
import { assembleRecord, licenseFromAbsHtml, ReaderOutput } from "../../lib/reader";
import { gh, OWNER, REPO, repoPath } from "./github";
import type { PaperRef } from "./night-steps";

/** Plain helpers for read_night's steps. Only step bodies call them, so the workflow bundle never loads this module. */

/** arXiv categories read each night, fetched in one RSS request (about 500 items, 1 MB). */
export const CATEGORIES = ["cs.AI", "cs.CL", "cs.LG", "cs.MA"];
/** New submissions shown to the picker, in feed order. */
export const MAX_CANDIDATES = 60;
export const USER_AGENT = `paper-desk (https://github.com/${OWNER}/${REPO})`;

export async function fetchText(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  return { status: res.status, text: res.status === 200 ? await res.text() : "" };
}

/** arXiv ids already read: every merged night's record. */
export async function alreadyRead(): Promise<Set<string>> {
  const ids = new Set<string>();
  let dirs: { name: string; type: string }[] = [];
  try {
    dirs = await gh<{ name: string; type: string }[]>("GET", repoPath("/contents/nights"));
  } catch (e) {
    if (!String(e).includes("-> 404")) throw e;
  }
  for (const d of dirs.filter((x) => x.type === "dir")) {
    const r = await fetchText(`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/nights/${d.name}/record.json`);
    if (r.status !== 200) continue;
    const id = (JSON.parse(r.text) as { paper?: { arxiv_id?: string } }).paper?.arxiv_id;
    if (id) ids.add(id);
  }
  return ids;
}

/** The abs page gives the current version and the license; the HTML page gives the text. Null when there's no HTML. */
export async function loadPaper(arxivId: string) {
  const abs = await fetchText(`https://arxiv.org/abs/${arxivId}`);
  if (abs.status !== 200) return null;
  const version = abs.text.match(new RegExp(`${arxivId.replace(".", "\\.")}(v\\d+)`))?.[1] ?? "v1";
  const html = await fetchText(`https://arxiv.org/html/${arxivId}${version}`);
  if (html.status !== 200) return null;
  const parsed = parseArxivHtml(html.text, { arxivId, version });
  if (parsed.paragraphs.length === 0) return null;
  return { parsed, license: licenseFromAbsHtml(abs.text), version };
}

/** Re-parses the same version, so checks run against the page, not against anything the model saw or said. */
export async function parsedFor(ref: PaperRef) {
  const html = await fetchText(`https://arxiv.org/html/${ref.arxiv_id}${ref.version}`);
  if (html.status !== 200) throw new Error(`arXiv HTML ${ref.arxiv_id}${ref.version} -> ${html.status}`);
  return parseArxivHtml(html.text, { arxivId: ref.arxiv_id, version: ref.version });
}

/** Parses the model's output (stripping unknown keys) and assembles the strict record. Throws when malformed. */
export function buildRecord(output: unknown, paper: ReturnType<typeof parseArxivHtml>, ref: PaperRef) {
  return assembleRecord(ReaderOutput.parse(output), paper, ref);
}
