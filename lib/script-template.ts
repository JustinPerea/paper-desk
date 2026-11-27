import type { FullRecord } from "./record.ts";
import { normalizeText } from "./verify.ts";
import { spokenValue, screenValue } from "./number-render.ts";

/**
 * Script templates. The scriptwriter writes `narration` and `on_screen` as templates: ordinary words plus `{{id}}`
 * placeholders that name a verified record number. Code renders the placeholders and checks that nothing else in the
 * template can state a number or name someone the record doesn't back. See implementation-notes.md ("Piece 4
 * hardening") for the reasoning behind each rule.
 */

/** Always build a fresh regex from this source: a shared /g regex keeps lastIndex between calls. */
const PLACEHOLDER_SRC = String.raw`\{\{([^{}]*)\}\}`;
/** Stands in for a removed placeholder; it is not a letter, a space or punctuation, so it breaks every token run. */
const MARK = "\u0001";

export class RenderError extends Error {
  constructor(
    public code: "unknown_number_id" | "number_not_speakable",
    public id: string,
  ) {
    super(code === "unknown_number_id" ? `placeholder {{${id}}} is not a verified number` : `number ${id} has no exact spoken form`);
  }
}

export type NumberLookup = Map<string, { value: string }>;

/** Replace each `{{id}}` with the number's spoken or screen form. Throws RenderError for an unknown id or an unspeakable value. */
export function renderTemplate(template: string, numbers: NumberLookup, mode: "spoken" | "screen"): { text: string; ids: string[] } {
  const ids: string[] = [];
  const text = template.replace(new RegExp(PLACEHOLDER_SRC, "g"), (_m, id: string) => {
    const n = numbers.get(id);
    if (!n) throw new RenderError("unknown_number_id", id);
    let out: string | null;
    if (mode === "spoken") {
      out = spokenValue(n.value);
      if (out === null) throw new RenderError("number_not_speakable", id);
    } else out = screenValue(n.value);
    if (!ids.includes(id)) ids.push(id);
    return out;
  });
  return { text, ids };
}

// ---------------------------------------------------------------------------------------------------------------
// Number rules
// ---------------------------------------------------------------------------------------------------------------

const SINGLE = "zero two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const SCALES = "hundred thousand million billion trillion dozen".split(" ");
const FRACTIONS = "half halves quarter quarters third thirds fourth fourths fifth fifths sixth sixths seventh sevenths eighth eighths ninth ninths tenth tenths".split(" ");
const ORDINALS = "twelfth twelfths twentieth twentieths thirtieth thirtieths fortieth fortieths fiftieth fiftieths sixtieth sixtieths seventieth seventieths eightieth eightieths ninetieth ninetieths".split(" ");
const MULTIPLIERS = "double doubled doubles doubling triple tripled triples tripling twice thrice".split(" ");
const PERCENT = ["percent", "percentage"];
const PLURALS = [...SCALES.filter((w) => w !== "dozen").map((w) => `${w}s`), "dozens", "twenties", "thirties", "forties", "fifties", "sixties", "seventies", "eighties", "nineties"];
/** Every word that states or builds a number, except "one" and "point", which have idiom rules below. */
const NUMBER_WORDS = new Set([...SINGLE, ...TENS, ...SCALES, ...FRACTIONS, ...ORDINALS, ...MULTIPLIERS, ...PERCENT, ...PLURALS]);
/**
 * Words that change a number when they sit next to its placeholder: scale and unit letters ("{{n}} K", "{{n}} bn"),
 * ordinal endings, "fold", "pct", and "times", which turns a count into a multiplier ("{{n}} times faster"; write
 * "{{n}} runs" or "ran {{n}} tasks" instead). "times" elsewhere in a sentence is fine.
 */
const NEIGHBOR_AFTER = new Set("k m b bn mn mil mm x fold pct pc grand th st nd rd times".split(" "));
/** Words that give a placeholder a sign. */
const NEIGHBOR_BEFORE = new Set("minus negative plus".split(" "));
export const FUZZY_TARGETS = [...NUMBER_WORDS].filter((w) => w.length >= 5);
const FOLD_SUFFIX = new RegExp(`^(?:${[...SINGLE, "one", ...TENS, ...SCALES].join("|")})fold$`);

/**
 * Ordinary words one edit away from a number word of five or more letters ("height" and "light" from "eight", "even"
 * from "seven", "there" from "three" by a transposition). Without this list the fuzzy rule that catches misspellings
 * ("fourty", "ninty", "fivty", "eigth") would reject common prose. Found by checking the number words against a
 * system dictionary; every entry is an ordinary word, not a number. A test checks each entry really is one edit away
 * from a number word, so the list cannot grow stale or pick up words that need no entry.
 */
export const FUZZY_ALLOWLIST = new Set(
  (
    "even seen sever tree thee there threw thrive height weight weighty light might mighty night right sight tight fight " +
    "fort forth forte foray tent teeth nifty filth doable doubly doubler doublet doublets doze dozed dozer twine tripe " +
    "trifle triplet triplex calves halve halved quartet percept thirsty silty"
  ).split(" "),
);

/**
 * Ordinary words that contain a number word of five or more letters ("millionaire" holds "million", "quarterly" holds
 * "quarter", "percentile" holds "percent"). Any other word that contains one ("twentieth", "hundredth", "fortytwo",
 * "threefold", "thousandfold") is a number in disguise and is rejected. "eight" is left out of this rule because it
 * sits inside "height", "weight" and "freight"; it is covered by the exact and fuzzy rules and by "eighty" and the like.
 */
export const SUBSTRING_ALLOWLIST = new Set(
  (
    "quarterly quarterback quarterbacks headquarter headquarters headquartered quartered quartermaster millionaire millionaires " +
    "billionaire billionaires triplet triplets triplex doublet doublets percentile percentiles weighty"
  ).split(" "),
);
const SUBSTRING_TARGETS = [...NUMBER_WORDS].filter((w) => w.length >= 5 && w !== "eight");
const PIECES = new Set([...NUMBER_WORDS, "one", "point"]);

/** Whether the word is two or more number words run together: "fortytwo", "twentyone", "onetwo". */
function isCompound(w: string): boolean {
  const best: number[] = Array(w.length + 1).fill(Infinity);
  best[0] = 0;
  for (let i = 1; i <= w.length; i++) {
    for (let j = Math.max(0, i - 12); j < i; j++) if (best[j]! < Infinity && PIECES.has(w.slice(j, i))) best[i] = Math.min(best[i]!, best[j]! + 1);
  }
  return best[w.length]! >= 2 && best[w.length]! < Infinity;
}

/** Optimal string alignment distance: insert, delete, substitute or swap two neighbors, each one edit. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

interface Tok {
  text: string;
  index: number;
  end: number;
  /** Everything between the previous token and this one. */
  sep: string;
}

function scan(text: string, re: RegExp): Tok[] {
  const out: Tok[] = [];
  let prevEnd = 0;
  for (const m of text.matchAll(re)) {
    const index = m.index!;
    out.push({ text: m[0], index, end: index + m[0].length, sep: text.slice(prevEnd, index) });
    prevEnd = index + m[0].length;
  }
  return out;
}

/** Latin letters that look like a-z but do not decompose to it. Applied before matching number words. */
const LOOKALIKE: Record<string, string> = { "ı": "i", "ø": "o", "ł": "l", "đ": "d", "ð": "d", "ħ": "h", "ŧ": "t", "ƒ": "f", "ǝ": "e", "ß": "ss", "æ": "ae", "œ": "oe" };
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ıøłđðħŧƒǝßæœ]/g, (c) => LOOKALIKE[c]!);
/**
 * Letters allowed in a template: Basic Latin, Latin-1, Latin Extended-A and B (to U+024F) and the precomposed
 * Vietnamese block. IPA, phonetic extensions and Latin Extended-C/D hold small capitals and other look-alikes
 * ("ꜰɪᴠᴇ") that NFKC leaves alone and that no spoken number word needs.
 */
const inLatinRange = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x41 && c <= 0x24f) || (c >= 0x1e00 && c <= 0x1eff);
};
const ROMAN = /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
const ALLOWED_CHAR = /^[ \u0001'’‘"“”,.;:!?()\-–—/&]$/;

/** Remove placeholders (raw text, so a look-alike such as a fullwidth brace is not removed) and NFKC what is left. */
function prepare(template: string): string {
  return template.replace(new RegExp(PLACEHOLDER_SRC, "g"), MARK).normalize("NFKC");
}

/**
 * Number problems in a template, as short messages (empty when clean). The template with its placeholders removed
 * may hold only Latin letters, combining marks, spaces and a short list of punctuation; no digits of any script; and
 * no word that states a number, a fraction, a multiplier or a percentage, nor a near-miss spelling of one.
 */
export function numberIssues(template: string): string[] {
  const issues = new Set<string>();
  const t = prepare(template);

  // 1. Character whitelist. NFKC already turned fullwidth and superscript digits and vulgar fractions into digits or
  // symbols; zero-width characters, U+2011, other scripts (CJK numerals are letters, Cyrillic letters look Latin) and
  // symbols such as % # $ + = are all rejected here.
  if (/\p{N}/u.test(t) || /\p{N}/u.test(template.replace(new RegExp(PLACEHOLDER_SRC, "g"), ""))) issues.add("contains a digit or numeric character outside a placeholder");
  const bad = new Set<string>();
  for (const ch of t) {
    if (ALLOWED_CHAR.test(ch)) continue;
    if (/\p{L}/u.test(ch) && /\p{Script=Latin}/u.test(ch) && inLatinRange(ch)) continue;
    if (/\p{M}/u.test(ch)) continue;
    if (!/\p{N}/u.test(ch)) bad.add(`U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  if (bad.size) issues.add(`contains characters that are not allowed outside a placeholder (${[...bad].slice(0, 5).join(", ")})`);

  // 2. Where a placeholder may sit. Text that touches one can change its value: "{{n}}K", "-{{n}}", "{{a}}/{{b}}",
  // "{{a}}–{{b}}", "{{n}}th". So on each side only a space (or the text's end) may follow the placeholder, after at most a
  // run of closing punctuation; and only a space or the start may come before it, after at most a run of opening
  // punctuation. Two placeholders need a word between them.
  for (let p = t.indexOf(MARK); p >= 0; p = t.indexOf(MARK, p + 1)) {
    const left = t.slice(0, p).replace(/[("“‘']+$/, "");
    const right = t.slice(p + 1).replace(/^[),.;:!?"”’']+/, "");
    if ((left !== "" && !left.endsWith(" ")) || (right !== "" && !right.startsWith(" "))) {
      issues.add("a placeholder is touching a letter, dash, slash or mark; it must stand alone between spaces or punctuation");
    }
  }
  if (new RegExp(`${MARK}[^\\p{L}]*${MARK}`, "u").test(t)) issues.add("two placeholders have no word between them; put a word between them");

  // 3. Words. Tokens are lowercased with accents removed, so "fórty" is "forty"; a hyphen splits ("twenty-one").
  const toks = scan(t, /\p{L}[\p{L}\p{M}]*/gu).map((k) => ({ ...k, w: fold(k.text) }));
  const spaced = (sep: string) => /^ *$/.test(sep);
  toks.forEach((k, i) => {
    const prev = toks[i - 1], next = toks[i + 1];
    if (NUMBER_WORDS.has(k.w) || FOLD_SUFFIX.test(k.w)) {
      issues.add(`"${k.text}" states a number`);
    } else if (k.w === "one") {
      const idiom =
        (next !== undefined && (next.w === "of" || next.w === "another") && spaced(next.sep)) ||
        (prev !== undefined && ["no", "any", "every", "some"].includes(prev.w) && spaced(k.sep));
      if (!idiom) issues.add(`"${k.text}" states a number (only "no one", "any one", "every one", "some one", "one of" and "one another" are allowed)`);
    } else if (k.w === "point") {
      const numTok = (o: { w: string } | undefined, sep: string) => o !== undefined && (NUMBER_WORDS.has(o.w) || o.w === "one") && spaced(sep);
      const holder = /\u0001 *$/.test(t.slice(0, k.index)) || /^ *\u0001/.test(t.slice(k.end));
      if (numTok(prev, k.sep) || numTok(next, next?.sep ?? "x") || holder) issues.add(`"point" next to a number or a placeholder builds a decimal`);
    } else if (k.w.length >= 4 && !FUZZY_ALLOWLIST.has(k.w) && !SUBSTRING_ALLOWLIST.has(k.w)) {
      const inside = SUBSTRING_TARGETS.find((n) => k.w.includes(n));
      const hit = FUZZY_TARGETS.find((n) => Math.abs(n.length - k.w.length) <= 1 && editDistance(k.w, n) === 1);
      if (inside) issues.add(`"${k.text}" contains the number word "${inside}"`);
      else if (isCompound(k.w)) issues.add(`"${k.text}" is number words run together`);
      else if (hit) issues.add(`"${k.text}" is one edit from the number word "${hit}"`);
    }
    // A word beside a placeholder that scales, signs or converts it ("{{n}} K", "minus {{n}}", "{{n}} fold").
    if (NEIGHBOR_AFTER.has(k.w) && /\u0001 *$/.test(t.slice(0, k.index))) issues.add(`"${k.text}" right after a placeholder changes its value`);
    if (NEIGHBOR_BEFORE.has(k.w) && /^ *\u0001/.test(t.slice(k.end))) issues.add(`"${k.text}" right before a placeholder changes its value`);
    // Roman numerals: all capitals, so "MIX" is caught and "mix" and "Mix" are not. A lone "I" is the pronoun.
    if (k.text !== "I" && /^[IVXLCDM]+$/.test(k.text) && ROMAN.test(k.text)) issues.add(`"${k.text}" is a Roman numeral`);
  });
  // A number word split across tokens ("for ty", "thir teen", "t w o", "per cent") is spoken as the word.
  for (let i = 0; i < toks.length; i++) {
    let joined = toks[i]!.w;
    for (let j = i + 1; j < Math.min(toks.length, i + 5) && joined.length <= 12; j++) {
      if (!/^[ \u0001'’-]*$/.test(toks[j]!.sep)) break;
      joined += toks[j]!.w;
      if (NUMBER_WORDS.has(joined)) issues.add(`"${toks.slice(i, j + 1).map((x) => x.text).join(" ")}" spells a number across words`);
    }
  }
  return [...issues];
}

const LINK = /:\/\/|www\.|[\p{L}\p{N}-]\.(?:com|org|net|edu|gov|io|ai|dev|app|co|ly|me|xyz|gg|tv|info|biz|ru|cn|de|uk|sh|so|to|cc|ws|vip|top|site|online|link|page)(?![\p{L}])/iu;

/** A script is read aloud and shown with no human review, so it carries no link or domain name. */
export function linkIssues(template: string): string[] {
  return LINK.test(prepare(template)) ? ["contains a link or domain name"] : [];
}

// ---------------------------------------------------------------------------------------------------------------
// Name rules
// ---------------------------------------------------------------------------------------------------------------

/** The texts a name may come from: the paper title, authors as printed, verified named people and verified quotes. */
export function nameSources(record: FullRecord): string[] {
  return [record.paper.title, ...record.paper.authors_as_printed, ...record.named_people, ...record.quotes.map((q) => q.text)].map(normalizeText);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-sensitive, with no letter, digit or hyphen touching either end of the match. */
function inSources(phrase: string, sources: string[]): boolean {
  const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}-])${escapeRe(phrase)}(?![\\p{L}\\p{M}\\p{N}-])`, "u");
  return sources.some((s) => re.test(s));
}

const NAME_LEADERS = new Set(["by", "from", "with"]);
/**
 * Words that start a sentence with a capital only because of their position. A run that opens a sentence may drop its
 * first word only when it is one of these; any other first word ("Sidney" in "Sidney Pearson") is part of the name.
 */
const SENTENCE_OPENERS = new Set(
  (
    "The A An This That These Those It Its They Their We Our Here There Each Some Many Most Both All Any No In On At For And But So Or Then " +
    "If When While As By From With Of To After Before Also Still Yet Now What Why How Who Whether Because Since Although Instead Overall Today Next Finally"
  ).split(" "),
);

/**
 * Names the record doesn't back. A run of two or more capitalized words must appear verbatim in the sources; a run
 * that opens a sentence may drop its first word when that is a common sentence opener ("The Terminal-Bench team"),
 * and what is left must then be in the sources. A single capitalized word right after "by", "from" or "with" must be a whole word
 * of the sources. Not caught: a single capitalized word anywhere else ("Smith proved it").
 */
export function nameIssues(template: string, sources: string[]): string[] {
  const issues = new Set<string>();
  const t = normalizeText(prepare(template));
  const words = scan(t, /\p{L}[\p{L}\p{M}]*(?:['-]\p{L}[\p{L}\p{M}]*)*/gu).map((w) => ({ ...w, text: w.text.replace(/'s$/, "") }));
  const cap = (s: string) => /^\p{Lu}/u.test(s);
  let i = 0;
  while (i < words.length) {
    if (!cap(words[i]!.text)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < words.length && cap(words[j]!.text) && words[j]!.sep === " ") j++;
    const run = words.slice(i, j).map((w) => w.text);
    const starts = i === 0 || /[.!?]/.test(words[i]!.sep);
    if (run.length >= 2) {
      let ok = inSources(run.join(" "), sources);
      if (!ok && starts && SENTENCE_OPENERS.has(run[0]!)) ok = inSources(run.slice(1).join(" "), sources);
      if (!ok) issues.add(`"${run.join(" ")}" is a name that is not in the paper's title, authors, named people or quotes`);
    } else if (i > 0 && words[i]!.sep === " " && NAME_LEADERS.has(words[i - 1]!.text.toLowerCase())) {
      if (!inSources(run[0]!, sources)) issues.add(`"${run[0]}" after "${words[i - 1]!.text}" is a name that is not in the paper's title, authors, named people or quotes`);
    }
    i = j;
  }
  return [...issues];
}
