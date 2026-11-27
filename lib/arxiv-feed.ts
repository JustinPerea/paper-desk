import * as cheerio from "cheerio";
import { cleanText, LIMITS } from "./sanitize.ts";

export interface Candidate {
  arxiv_id: string;
  version: string;
  title: string;
  abstract: string;
  categories: string[];
  announce_type: string;
}

const ABSTRACT_MAX = 1500;
const ID = /(\d{4}\.\d{4,5})/;

/**
 * Parse arXiv's RSS 2.0 feed (https://rss.arxiv.org/rss/cs.AI+cs.CL). The description starts
 * "arXiv:<id>v<n> Announce Type: <type> \nAbstract: <text>". Titles and abstracts are untrusted.
 */
export function parseArxivRss(xml: string): Candidate[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: Candidate[] = [];
  $("item").each((_, el) => {
    const item = $(el);
    const desc = item.children("description").text();
    const head = desc.match(/^\s*arXiv:(\d{4}\.\d{4,5})(v\d+)?/);
    const link = item.children("link").text().trim();
    const arxiv_id = head?.[1] ?? link.match(ID)?.[1];
    if (!arxiv_id) return;
    const version = head?.[2] ?? link.match(/\d{4}\.\d{4,5}(v\d+)/)?.[1] ?? "v1";
    const announce_type =
      item.children("arxiv\\:announce_type").text().trim() || desc.match(/Announce Type:\s*([a-z-]+)/i)?.[1]?.toLowerCase() || "";
    const abstractRaw = desc.match(/Abstract:\s*([\s\S]*)$/)?.[1] ?? "";
    const title = cleanText(item.children("title").text(), LIMITS.title);
    if (!title) return;
    const categories = item
      .children("category")
      .map((__, c) => $(c).text().trim())
      .get()
      .filter(Boolean);
    out.push({ arxiv_id, version, title, abstract: cleanText(abstractRaw, ABSTRACT_MAX) ?? "", categories, announce_type });
  });
  return out;
}

/** New submissions only, deduped by id, minus papers already read, in feed order, capped. */
export function selectNew(cands: Candidate[], alreadyRead: Set<string>, max = 40): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    if (out.length >= max) break;
    if (c.announce_type !== "new" || seen.has(c.arxiv_id) || alreadyRead.has(c.arxiv_id)) continue;
    seen.add(c.arxiv_id);
    out.push(c);
  }
  return out;
}

/** The candidates the picker named, in its order. Ids that are not in the list, and repeats, are ignored. */
export function validatePick(pick: { arxiv_ids: string[] }, cands: Candidate[]): Candidate[] {
  const byId = new Map(cands.map((c) => [c.arxiv_id, c]));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const id of pick.arxiv_ids) {
    const c = typeof id === "string" ? byId.get(id) : undefined;
    if (!c || seen.has(id)) continue;
    seen.add(id);
    out.push(c);
  }
  return out;
}
