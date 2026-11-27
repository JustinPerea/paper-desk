import * as cheerio from "cheerio";
import type { ParsedPaper } from "./arxiv-html.ts";
import { FullRecord } from "./record.ts";
import type { VerifyResult } from "./verify.ts";

import { ReaderOutput } from "./reader-schema.ts";

export { ReaderOutput };

/** Render the parsed paper as plain text with every citable block prefixed by its id, e.g. "[S3.p4] (3 Results) text". */
export function paperForReader(paper: ParsedPaper, maxChars = 300_000): { text: string; truncated: boolean } {
  let text = `Title: ${paper.title}\nAuthors: ${paper.authors_as_printed.join(", ")}\n`;
  const blocks: string[] = [
    ...paper.abstract.map((p) => `[${p.id}] (Abstract) ${p.text}`),
    ...paper.paragraphs.map((p) => `[${p.id}] (${p.section_title}) ${p.text}`),
    ...paper.tables.map((t) => `[${t.id}] (Table) ${t.caption}\n${t.text}`),
    ...paper.figures.map((f) => `[${f.id}] (Figure) ${f.caption}`),
  ];
  let truncated = false;
  for (const b of blocks) {
    if (text.length + 2 + b.length > maxChars) {
      truncated = true;
      break;
    }
    text += `\n${b}\n`;
  }
  return { text, truncated };
}

/** Build the full record. The paper identity comes only from code; FullRecord.parse throws on a malformed record. */
export function assembleRecord(out: ReaderOutput, paper: ParsedPaper, meta: { url: string; license: string | null; read_at: string }): FullRecord {
  const sectionOf = new Map<string, string>();
  for (const p of paper.abstract) sectionOf.set(p.id, "Abstract");
  for (const p of paper.paragraphs) sectionOf.set(p.id, p.section_title);
  for (const t of paper.tables) sectionOf.set(t.id, "");
  for (const f of paper.figures) sectionOf.set(f.id, "");
  return FullRecord.parse({
    // Spread first: any field the schema does not know reaches the strict FullRecord and is rejected, not dropped.
    ...out,
    paper: {
      title: paper.title,
      authors_as_printed: paper.authors_as_printed,
      affiliations: [],
      arxiv_id: paper.arxiv_id,
      version: paper.version,
      url: meta.url,
      license: meta.license,
      read_at: meta.read_at,
      source: "html",
    },
    quotes: out.quotes.map((q) => ({ ...q, section_title: sectionOf.get(q.anchor) ?? "" })),
    compact: { ...out.compact, license: meta.license, depth: "full" },
  });
}

/** One repair round's message, or null when nothing failed. */
export function repairMessage(result: VerifyResult, record: FullRecord): string | null {
  if (result.all_ok && result.numeral_issues.length === 0) return null;
  const lines: string[] = [];
  const q = result.quotes.filter((x) => x.status !== "ok");
  if (q.length) {
    lines.push("Quotes that failed verification:");
    for (const x of q) {
      const rec = record.quotes.find((r) => r.id === x.id);
      const where = x.found_in?.length ? `; the text was found under ${x.found_in.join(", ")}, not under ${rec?.anchor ?? "its anchor"}` : "";
      lines.push(`- ${x.id}: ${x.status}${where}`);
    }
  }
  const n = result.numbers.filter((x) => x.status !== "ok");
  if (n.length) {
    lines.push("Numbers that failed:");
    for (const x of n) lines.push(`- ${x.id}: ${x.status}`);
  }
  const c = result.claims.filter((x) => x.status === "no_ok_quote");
  if (c.length) {
    lines.push('Claims marked "authors" with no verified quote (add a verified quote, mark them "inference", or remove them):');
    for (const x of c) lines.push(`- claims[${x.index}]: ${record.claims[x.index]?.text.slice(0, 120) ?? ""}`);
  }
  const l = result.limits_authors.filter((x) => x.status !== "ok");
  if (l.length) {
    lines.push("Author limits that failed:");
    for (const x of l) lines.push(`- limits_authors[${x.index}]: ${x.status}`);
  }
  if (result.numeral_issues.length) {
    lines.push("Numerals that appear in a field but in no verified number or quote:");
    for (const x of result.numeral_issues) lines.push(`- ${x.field}: ${x.numeral}`);
  }
  if (!result.paper_match) lines.push("The record names a different paper or version than the one you were given.");
  return [
    "Verification found problems in your output.",
    ...lines,
    "",
    "Return the full corrected output in the same format. Fix each quote by copying the text word for word from the paragraph whose id is the anchor. Remove anything you cannot support from the paper text.",
  ].join("\n");
}

/** The license URL from arXiv's abstract page, normalized to https, or null. */
export function licenseFromAbsHtml(html: string): string | null {
  const $ = cheerio.load(html);
  const href = $(".abs-license a[href]").first().attr("href")?.trim();
  if (!href) return null;
  try {
    const u = new URL(href, "https://arxiv.org/");
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}
