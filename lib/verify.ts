import type { FullRecord } from "./record.ts";
import type { ParsedPaper } from "./arxiv-html.ts";

/** NFKC, straight quotes, one dash, collapsed whitespace. Everything else is exact and case-sensitive. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a number for matching: "26.8 %" == "26.8%", "5,400" == "5400". */
export function normalizeNumberText(s: string): string {
  // Fold every Unicode decimal digit (Arabic-Indic, Devanagari, ...) to ASCII; NFKC leaves many of them alone.
  // NFKC first, so compatibility digits (fullwidth, mathematical) are already ASCII before the fold.
  const ascii = s.normalize("NFKC").replace(/\p{Nd}/gu, (d) => String(digitValue(d)));
  let t = normalizeText(ascii.replace(/\u066B/g, ".").replace(/\u066C/g, ",")).replace(/\s+%/g, "%");
  t = t.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  return t;
}

/**
 * Value of a \p{Nd} digit. Unicode encodes every decimal digit set as ten consecutive code points, 0 to 9,
 * and some sets sit back to back (the five mathematical digit sets), so walk to the start of the whole run
 * of digits and take the offset modulo 10. A run longer than 200 is not a real digit run: reject it.
 */
function digitValue(ch: string): number {
  const cp = ch.codePointAt(0)!;
  let start = cp;
  while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) {
    start--;
    if (cp - start > 200) throw new Error(`unrecognized digit U+${cp.toString(16)}`);
  }
  return (cp - start) % 10;
}

const NUM_TOKEN = /\d[\d,]*(?:\.\d+)?/g;
/** Numeral tokens of a string, thousands separators removed. Shared with script.ts. */
export function numerals(s: string): string[] {
  return (normalizeNumberText(s).match(NUM_TOKEN) ?? []).map((t) => t.replace(/,/g, ""));
}

/** A quote must carry enough text to prove something: 6 words in a paragraph, 3 tokens in a table. */
export const MIN_QUOTE_WORDS = 6;
export const MIN_TABLE_QUOTE_TOKENS = 3;

export function containsNumber(haystack: string, needle: string): boolean {
  const h = normalizeNumberText(haystack);
  const n = normalizeNumberText(needle);
  if (!n) return false;
  let from = 0;
  for (;;) {
    const i = h.indexOf(n, from);
    if (i < 0) return false;
    const before = h[i - 1] ?? "";
    const after = h[i + n.length] ?? "";
    const startsNum = /\d/.test(n[0]!);
    const endsNum = /\d/.test(n[n.length - 1]!);
    const glued = (startsNum && (/\d/.test(before) || (before === "." && /\d/.test(h[i - 2] ?? "")))) ||
      (endsNum && (/\d/.test(after) || (after === "." && /\d/.test(h[i + n.length + 1] ?? ""))));
    if (!glued) return true;
    from = i + 1;
  }
}

export type QuoteStatus = "ok" | "wrong_anchor" | "not_found" | "anchor_missing" | "too_short";
export interface QuoteResult {
  id: string;
  status: QuoteStatus;
  /** For wrong_anchor: ids where the text really is (repair hint). */
  found_in?: string[];
}
export type NumberStatus = "ok" | "value_not_in_quote" | "quote_not_ok" | "quote_missing";
export type ClaimStatus = "ok" | "inference" | "no_ok_quote";
export interface VerifyResult {
  quotes: QuoteResult[];
  numbers: { id: string; status: NumberStatus }[];
  claims: { index: number; status: ClaimStatus }[];
  limits_authors: { index: number; status: "ok" | "quote_not_ok" | "quote_missing" }[];
  inference_claims: number;
  /** Numerals in free-text fields that match no verified number and no ok quote. */
  numeral_issues: NumeralIssue[];
  /** False when the record names a different paper or version than the one parsed. */
  paper_match: boolean;
  all_ok: boolean;
}
export interface NumeralIssue {
  field: string;
  numeral: string;
}
export interface Dropped {
  kind: "quote" | "number" | "claim" | "limit" | "result";
  id: string;
  reason: string;
}

function anchorTexts(paper: ParsedPaper): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of paper.abstract) m.set(p.id, p.text);
  for (const p of paper.paragraphs) m.set(p.id, p.text);
  for (const t of paper.tables) m.set(t.id, `${t.caption}\n${t.text}`);
  for (const f of paper.figures) m.set(f.id, f.caption);
  return m;
}

export function verifyRecord(record: FullRecord, paper: ParsedPaper): VerifyResult {
  // The record is model-written; the parsed paper is the trusted identity.
  const paper_match = record.paper.arxiv_id === paper.arxiv_id && record.paper.version === paper.version;
  const texts = anchorTexts(paper);
  const norm = new Map([...texts].map(([k, v]) => [k, normalizeText(v)]));
  const quotes: QuoteResult[] = record.quotes.map((q) => {
    const needle = normalizeText(q.text);
    const at = norm.get(q.anchor);
    if (at === undefined) return { id: q.id, status: "anchor_missing" };
    const isTable = paper.tables.some((t) => t.id === q.anchor);
    const size = needle ? needle.split(" ").length : 0;
    if (size < (isTable ? MIN_TABLE_QUOTE_TOKENS : MIN_QUOTE_WORDS)) return { id: q.id, status: "too_short" };
    if (needle && at.includes(needle)) return { id: q.id, status: "ok" };
    const found = [...norm].filter(([, v]) => v.includes(needle)).map(([k]) => k);
    return found.length ? { id: q.id, status: "wrong_anchor", found_in: found.slice(0, 5) } : { id: q.id, status: "not_found" };
  });
  const qStatus = new Map(quotes.map((q) => [q.id, q.status]));
  const qText = new Map(record.quotes.map((q) => [q.id, q.text]));

  const numbers = record.numbers.map((n) => {
    const st = qStatus.get(n.quote_id);
    let status: NumberStatus;
    if (st === undefined) status = "quote_missing";
    else if (st !== "ok") status = "quote_not_ok";
    else status = containsNumber(qText.get(n.quote_id)!, n.value) ? "ok" : "value_not_in_quote";
    return { id: n.id, status };
  });

  const claims = record.claims.map((c, index) => {
    const hasOk = c.quote_ids.some((id) => qStatus.get(id) === "ok");
    const status: ClaimStatus = c.provenance === "inference" ? "inference" : hasOk ? "ok" : "no_ok_quote";
    return { index, status };
  });

  const limits_authors = record.limits_authors.map((l, index) => {
    const st = qStatus.get(l.quote_id);
    return { index, status: st === undefined ? ("quote_missing" as const) : st === "ok" ? ("ok" as const) : ("quote_not_ok" as const) };
  });

  // Numerals in free text must come from a verified number or an ok quote (years included: no carve-out).
  const allowed = new Set<string>();
  record.numbers.forEach((n, i) => {
    if (numbers[i]!.status === "ok") numerals(n.value).forEach((t) => allowed.add(t));
  });
  record.quotes.forEach((q, i) => {
    if (quotes[i]!.status === "ok") numerals(q.text).forEach((t) => allowed.add(t));
  });
  const numeral_issues: NumeralIssue[] = [];
  const scan = (field: string, text: string | null | undefined) => {
    if (!text) return;
    for (const t of numerals(text.split(paper.arxiv_id).join(" "))) if (!allowed.has(t)) numeral_issues.push({ field, numeral: t });
  };
  scan("compact.claim", record.compact.claim);
  record.compact.results.forEach((r, i) => scan(`compact.results[${i}].finding`, r.finding));
  scan("compact.limits", record.compact.limits);
  scan("change_for_agents", record.change_for_agents);
  record.claims.forEach((c, i) => scan(`claims[${i}].text`, c.text));
  record.limits_authors.forEach((l, i) => scan(`limits_authors[${i}].text`, l.text));
  record.numbers.forEach((n, i) => {
    scan(`numbers[${i}].comparison`, n.comparison);
    scan(`numbers[${i}].condition`, n.condition);
  });

  const all_ok =
    paper_match &&
    numeral_issues.length === 0 &&
    quotes.every((q) => q.status === "ok") &&
    numbers.every((n) => n.status === "ok") &&
    claims.every((c) => c.status !== "no_ok_quote") &&
    limits_authors.every((l) => l.status === "ok");
  return { quotes, numbers, claims, limits_authors, inference_claims: claims.filter((c) => c.status === "inference").length, numeral_issues, paper_match, all_ok };
}

/** Drop what failed. A dropped quote takes its numbers and limits with it; claims lose its id from quote_ids. */
export function applyVerification(
  record: FullRecord,
  result: VerifyResult,
): { record: FullRecord; dropped: Dropped[]; /** numeral issues left in single-string fields, for the workflow to regenerate */ reported: NumeralIssue[] } {
  const dropped: Dropped[] = [];
  const badAt = (prefix: string): Map<number, string[]> => {
    const m = new Map<number, string[]>();
    for (const i of result.numeral_issues) {
      const hit = i.field.match(new RegExp(`^${prefix}\\[(\\d+)\\]`));
      if (hit) m.set(Number(hit[1]), [...(m.get(Number(hit[1])) ?? []), i.numeral]);
    }
    return m;
  };
  const badNum = badAt("numbers"), badClaim = badAt("claims"), badLimit = badAt("limits_authors"), badResult = badAt("compact\\.results");
  const okQuotes = new Set<string>();
  for (const q of result.quotes) {
    if (q.status === "ok") okQuotes.add(q.id);
    else dropped.push({ kind: "quote", id: q.id, reason: q.status + (q.found_in ? ` (found in ${q.found_in.join(", ")})` : "") });
  }
  const badNumbers = new Map(result.numbers.filter((n) => n.status !== "ok").map((n) => [n.id, n.status]));
  const numbers = record.numbers.filter((n, i) => {
    const why = badNumbers.get(n.id);
    if (why) dropped.push({ kind: "number", id: n.id, reason: why });
    else if (badNum.has(i)) {
      dropped.push({ kind: "number", id: n.id, reason: `unverified_numeral ${badNum.get(i)!.join(", ")}` });
      return false;
    }
    return !why;
  });
  const claims = [];
  for (const [i, c] of record.claims.entries()) {
    const st = result.claims[i]!.status;
    if (st === "no_ok_quote") {
      dropped.push({ kind: "claim", id: `claim[${i}]`, reason: "no_ok_quote" });
      continue;
    }
    if (badClaim.has(i)) {
      dropped.push({ kind: "claim", id: `claim[${i}]`, reason: `unverified_numeral ${badClaim.get(i)!.join(", ")}` });
      continue;
    }
    claims.push({ ...c, quote_ids: c.quote_ids.filter((id) => okQuotes.has(id)) });
  }
  const limits_authors = record.limits_authors.filter((l, i) => {
    const st = result.limits_authors[i]!.status;
    if (st !== "ok") dropped.push({ kind: "limit", id: `limits_authors[${i}]`, reason: st });
    else if (badLimit.has(i)) {
      dropped.push({ kind: "limit", id: `limits_authors[${i}]`, reason: `unverified_numeral ${badLimit.get(i)!.join(", ")}` });
      return false;
    }
    return st === "ok";
  });
  const results = record.compact.results.filter((r, i) => {
    if (!badResult.has(i)) return true;
    dropped.push({ kind: "result", id: `compact.results[${i}]`, reason: `unverified_numeral ${badResult.get(i)!.join(", ")}` });
    return false;
  });
  const reported = result.numeral_issues.filter((i) => !/^(claims|limits_authors|numbers|compact\.results)\[/.test(i.field));
  return {
    record: { ...record, quotes: record.quotes.filter((q) => okQuotes.has(q.id)), numbers, claims, limits_authors, compact: { ...record.compact, results } },
    dropped,
    reported,
  };
}
