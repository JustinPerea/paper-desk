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

// normalizeNumberText already removed valid thousands separators, so any comma left separates two numbers.
const NUM_TOKEN = /\d+(?:\.\d+)?/g;
/** Numeral tokens of a string. One tokenizer for every side of every check; shared with script.ts. */
export function numerals(s: string): string[] {
  return normalizeNumberText(s).match(NUM_TOKEN) ?? [];
}

/** A quote must carry enough text to prove something: 6 words in a paragraph, 3 tokens in a table. */
export const MIN_QUOTE_WORDS = 6;
export const MIN_TABLE_QUOTE_TOKENS = 3;

/**
 * True when the needle (a number's value) is in the haystack (its quote): every numeral of the needle is a whole
 * numeral token of the haystack, and the needle's text appears with no digit glued to either side ("0.68" is not
 * in "0.684", ".5" is not in "10.5", "26" is not in "26.8").
 */
export function containsNumber(haystack: string, needle: string): boolean {
  const h = normalizeNumberText(haystack);
  const n = normalizeNumberText(needle);
  if (!n) return false;
  const hTokens = new Set(numerals(h));
  if (!numerals(n).every((t) => hTokens.has(t))) return false;
  const digit = (c: string | undefined) => c !== undefined && /\d/.test(c);
  let from = 0;
  for (;;) {
    const i = h.indexOf(n, from);
    if (i < 0) return false;
    const end = i + n.length;
    const gluedLeft = digit(h[i - 1]) || (/[.,]/.test(h[i - 1] ?? "") && digit(h[i - 2]) && digit(n[0]));
    const gluedRight = digit(h[end]) || (/[.,]/.test(h[end] ?? "") && digit(h[end + 1]) && digit(n[n.length - 1]));
    if (!gluedLeft && !gluedRight) return true;
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
export type NumberStatus = "ok" | "value_not_in_quote" | "quote_not_ok" | "quote_missing" | "context_not_in_quote";
export type PersonStatus = "ok" | "not_on_page";
export type ClaimStatus = "ok" | "inference" | "no_ok_quote";
export interface VerifyResult {
  quotes: QuoteResult[];
  numbers: { id: string; status: NumberStatus }[];
  claims: { index: number; status: ClaimStatus }[];
  limits_authors: { index: number; status: "ok" | "quote_not_ok" | "quote_missing" }[];
  /** named_people entries: each must appear verbatim in the parsed page text. */
  people: { index: number; status: PersonStatus }[];
  inference_claims: number;
  /** Numerals in any string field that match no verified number or ok quote (or, for paper metadata, the page). */
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
  kind: "quote" | "number" | "claim" | "limit" | "result" | "overclaim" | "person" | "figure" | "applies_to";
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

/** Words too common to carry meaning: function words and comparison scaffolding ("versus", "compared"). Words that give a direction (more, less, most, over, under, above, below, before, after, without) are deliberately not here: a comparison that flips one of them must still be in the quote. */
const CONTEXT_STOPWORDS = new Set(
  (
    "that this with from than then them they their there these those which while when where what were been being have does also " +
    "into across versus against between among each other such same both very about using used upon onto within through during compared relative relatively whose whom will would could should"
  ).split(" "),
);

/**
 * Words that flip or move a number's meaning, short ones included: "not", "no", "low", "up". A context that uses one
 * must find that exact word in the quote; a prefix or stem match would let "less" pass on "lesson" or "lower" on
 * "lowered". The rule checks that the word is in the quote, not where: a "not" anywhere in the quote satisfies it.
 */
const POLARITY_WORDS = new Set(
  (
    "not no nor non none never neither without only less more fewer least most low lower lowest high higher highest " +
    "worse worst better best below above under over up down before after min max"
  ).split(" "),
);

/** "don't" and "cannot" are said with a "not": split them out so the polarity rule sees it. */
const plainWords = (s: string): string[] =>
  normalizeText(s)
    .replace(/n['’]t\b/gi, " not")
    .replace(/\bcannot\b/gi, "can not")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/\p{L}+/gu) ?? [];

/** Common English endings, longest first. One is removed, and only when four letters or more remain. */
// No "ment": "increment" would stem to "incre" and match "increase". "improvement" still matches "improve" by prefix.
const SUFFIXES = "ations ation ings ing ions ion ies ied ily ally ly ed es s e al".split(" ");
function stem(w: string): string {
  for (const suf of SUFFIXES) if (w.endsWith(suf) && w.length - suf.length >= 4) return suf === "ily" || suf === "ies" || suf === "ied" ? w.slice(0, -suf.length) + "y" : w.slice(0, -suf.length);
  return w;
}
/**
 * Two words agree when their stems are equal or share all but the last letter of the shorter stem, and at least five
 * letters. A stem under five letters is too short to trust ("normal" and "norm" both stem to "norm", "causal" and
 * "cause" to "caus"), so such words must be equal or differ by a plural "s" or "es".
 */
function sameWord(w: string, sw: string, x: string, sx: string): boolean {
  if (sw.length < 5 || sx.length < 5) return w === x || w === `${x}s` || x === `${w}s` || w === `${x}es` || x === `${w}es`;
  return sameStem(sw, sx);
}
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(5, Math.min(a.length, b.length) - 1);
}

/**
 * A number's `comparison` or `condition` must come from its quote. A negation or direction word (any length) must be
 * in the quote as the same word. Every other content word (letters only, four or more of them, not a stopword) must
 * share a stem with some word of the quote: "conditions" matches "condition", "primarily" matches "primary",
 * "accurate" matches "accuracy", but "increase" does not match "increment". Null and empty are grounded.
 */
export function contextInQuote(context: string | null, quote: string): boolean {
  if (!context) return true;
  const q = plainWords(quote);
  const qSet = new Set(q);
  const qWords = q.filter((x) => x.length >= 4).map((x) => [x, stem(x)] as const);
  return plainWords(context).every((w) => {
    if (POLARITY_WORDS.has(w)) return qSet.has(w);
    if (w.length < 4 || CONTEXT_STOPWORDS.has(w)) return true;
    const sw = stem(w);
    return qWords.some(([x, sx]) => sameWord(w, sw, x, sx));
  });
}

/** Normalized page text a named person must appear in: abstract, paragraphs, tables and figure captions. */
function pageTexts(paper: ParsedPaper): string[] {
  return [...anchorTexts(paper).values()].map((t) => normalizeText(t).toLowerCase());
}

/** `name` verbatim (case-insensitive) in `text`, with no letter or digit touching either end. */
function containsName(texts: string[], name: string): boolean {
  const n = normalizeText(name).toLowerCase();
  if (!n) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{M}\\p{N}])`, "u");
  return texts.some((t) => re.test(t));
}

/**
 * Every string in the record with its path ("claims[0].text", "likely_overclaims[2]"). Walking the whole record means
 * a field added to the schema later is scanned for numerals by default; skipping one has to be written down below.
 */
export function stringFields(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringFields(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => stringFields(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/**
 * Not scanned: identifiers and machine fields (checked elsewhere or by the schema), quote text (verified against its
 * anchor) and number values (verified against their quote).
 */
const EXEMPT_FIELDS: RegExp[] = [
  /^paper\.(arxiv_id|version|url|license|read_at|source)$/,
  /^quotes\[\d+\]\.(id|text|anchor)$/,
  /^claims\[\d+\]\.(quote_ids\[\d+\]|provenance)$/,
  /^numbers\[\d+\]\.(id|value|quote_id)$/,
  /^limits_authors\[\d+\]\.quote_id$/,
  /^figures\[\d+\]\.id$/,
  /^compact\.(license|code_url|depth)$/,
];
/** Checked against the parsed page's title, authors, headings and captions as well as the verified quotes. */
const PAGE_FIELDS: RegExp[] = [
  /^paper\.(title|authors_as_printed\[\d+\]|affiliations\[\d+\])$/,
  /^quotes\[\d+\]\.section_title$/,
  /^figures\[\d+\]\.caption$/,
  /^named_people\[\d+\]$/,
  /^compact\.results\[\d+\]\.location$/,
];

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
    else if (!containsNumber(qText.get(n.quote_id)!, n.value)) status = "value_not_in_quote";
    else if (!contextInQuote(n.comparison, qText.get(n.quote_id)!) || !contextInQuote(n.condition, qText.get(n.quote_id)!)) status = "context_not_in_quote";
    else status = "ok";
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

  const pages = pageTexts(paper);
  const people = record.named_people.map((name, index) => ({ index, status: containsName(pages, name) ? ("ok" as const) : ("not_on_page" as const) }));

  // Numerals in free text must come from a verified number or an ok quote (years included: no carve-out).
  const allowed = new Set<string>();
  record.numbers.forEach((n, i) => {
    if (numbers[i]!.status === "ok") numerals(n.value).forEach((t) => allowed.add(t));
  });
  record.quotes.forEach((q, i) => {
    if (quotes[i]!.status === "ok") numerals(q.text).forEach((t) => allowed.add(t));
  });
  // Paper metadata (title, authors, section titles, captions) may carry numerals the quotes don't, such as
  // "Section 4.2" or an affiliation mark. Those fields are checked against the parsed page instead.
  const fromPage = new Set(allowed);
  [paper.title, ...paper.authors_as_printed, ...paper.sections.map((x) => x.title), ...paper.tables.map((t) => t.caption), ...paper.figures.map((f) => f.caption)]
    .forEach((t) => numerals(t).forEach((n) => fromPage.add(n)));
  // Anchor ids ("S4.T1") are page text too: a location may name one.
  texts.forEach((_, anchor) => numerals(anchor).forEach((n) => fromPage.add(n)));
  const numeral_issues: NumeralIssue[] = [];
  for (const [field, text] of stringFields(record)) {
    if (EXEMPT_FIELDS.some((re) => re.test(field))) continue;
    const ok = PAGE_FIELDS.some((re) => re.test(field)) ? fromPage : allowed;
    // The parsed paper's id is the trusted identity (paper_match checks the record's); the record's is not exempt.
    for (const t of numerals(text.split(paper.arxiv_id).join(" "))) if (!ok.has(t)) numeral_issues.push({ field, numeral: t });
  }

  const all_ok =
    paper_match &&
    numeral_issues.length === 0 &&
    quotes.every((q) => q.status === "ok") &&
    numbers.every((n) => n.status === "ok") &&
    claims.every((c) => c.status !== "no_ok_quote") &&
    limits_authors.every((l) => l.status === "ok") &&
    people.every((p) => p.status === "ok");
  return { quotes, numbers, claims, limits_authors, people, inference_claims: claims.filter((c) => c.status === "inference").length, numeral_issues, paper_match, all_ok };
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
  // Plain string lists and figures: drop the entry that carries the numeral.
  const dropEntries = <T,>(list: T[], prefix: string, kind: Dropped["kind"], label: string): T[] => {
    const bad = badAt(prefix);
    return list.filter((_, i) => {
      if (!bad.has(i)) return true;
      dropped.push({ kind, id: `${label}[${i}]`, reason: `unverified_numeral ${bad.get(i)!.join(", ")}` });
      return false;
    });
  };
  const likely_overclaims = dropEntries(record.likely_overclaims, "likely_overclaims", "overclaim", "likely_overclaims");
  const badNames = badAt("named_people");
  const named_people = record.named_people.filter((_, i) => {
    const st = result.people[i]?.status;
    if (st !== "ok") dropped.push({ kind: "person", id: `named_people[${i}]`, reason: st ?? "not_on_page" });
    else if (badNames.has(i)) dropped.push({ kind: "person", id: `named_people[${i}]`, reason: `unverified_numeral ${badNames.get(i)!.join(", ")}` });
    return st === "ok" && !badNames.has(i);
  });
  const figures = dropEntries(record.figures, "figures", "figure", "figures");
  const applies_to = dropEntries(record.compact.applies_to, "compact\\.applies_to", "applies_to", "compact.applies_to");
  const reported = result.numeral_issues.filter(
    (i) => !/^(claims|limits_authors|numbers|compact\.results|likely_overclaims|named_people|figures|compact\.applies_to)\[/.test(i.field),
  );
  return {
    record: {
      ...record,
      quotes: record.quotes.filter((q) => okQuotes.has(q.id)),
      numbers,
      claims,
      limits_authors,
      likely_overclaims,
      named_people,
      figures,
      compact: { ...record.compact, results, applies_to },
    },
    dropped,
    reported,
  };
}

const NULLABLE_FIELDS = new Set(["change_for_agents", "compact.limits"]);

function splitSentences(s: string): string[] {
  return s.split(/(?<=[.!?]["')\]]?)\s+/).filter((x) => x.trim() !== "");
}

/**
 * applyVerification only reports numeral issues in single-string fields. This removes, from each reported field,
 * every sentence that holds the reported numeral as a whole token. A field with nothing left becomes null when the
 * schema allows it (change_for_agents, compact.limits) and "" otherwise. Returns a new record.
 */
export function stripReported(record: FullRecord, reported: NumeralIssue[]): FullRecord {
  const out = structuredClone(record) as unknown as Record<string, unknown>;
  const byField = new Map<string, string[]>();
  for (const r of reported) byField.set(r.field, [...(byField.get(r.field) ?? []), r.numeral]);
  for (const [field, nums] of byField) {
    const keys = field.split(/\.|\[(\d+)\]/).filter((k): k is string => !!k).map((k) => (/^\d+$/.test(k) ? Number(k) : k));
    let parent: any = out;
    for (const k of keys.slice(0, -1)) parent = parent?.[k];
    const last = keys[keys.length - 1]!;
    const cur = parent?.[last];
    if (typeof cur !== "string") continue;
    const kept = splitSentences(cur).filter((sent) => !nums.some((n) => containsNumber(sent, n)));
    parent[last] = kept.length ? kept.join(" ") : NULLABLE_FIELDS.has(field) ? null : "";
  }
  return out as unknown as FullRecord;
}
