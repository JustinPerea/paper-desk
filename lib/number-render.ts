import { normalizeNumberText } from "./verify.ts";

/**
 * Rendering of a verified number value for a script. The scriptwriter never writes a number; it writes a `{{id}}`
 * placeholder and code puts the value in. `spokenValue` gives the narration form (English words), `screenValue` the
 * on-screen form. A value that cannot be rendered exactly has no spoken form (null), so it cannot be narrated.
 */

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) parts.push(r < 20 ? ONES[r]! : r % 10 ? `${TENS[Math.floor(r / 10)]}-${ONES[r % 10]}` : TENS[Math.floor(r / 10)]!);
  return parts.join(" ");
}

/** Integers 0 to 999,999,999,999 as words: "five thousand four hundred". No "and". */
export function integerToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new RangeError(`cannot render ${n}`);
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as const) {
    const q = Math.floor(n / size);
    if (q) {
      parts.push(`${below1000(q)} ${name}`);
      n -= q * size;
    }
  }
  if (n) parts.push(below1000(n));
  return parts.join(" ");
}

/** "26.8" -> "twenty-six point eight"; "0.50" -> "zero point five zero" (every digit is said, so nothing is rounded). */
function decimalToWords(num: string): string | null {
  const [int, frac] = num.split(".") as [string, string | undefined];
  // A leading zero other than a lone "0" has no exact spoken form that reads back to the same numeral.
  if (!/^(?:0|[1-9]\d*)$/.test(int) || int.length > 12) return null;
  if (frac !== undefined && (frac.length === 0 || frac.length > 12)) return null;
  const head = integerToWords(Number(int));
  return frac === undefined ? head : `${head} point ${[...frac].map((d) => ONES[Number(d)]).join(" ")}`;
}

const SCALE_EXP: Record<string, number> = { K: 3, k: 3, M: 6, B: 9, bn: 9 };
const SCALE_WORD: Record<string, string> = { K: "thousand", k: "thousand", M: "million", B: "billion", bn: "billion" };

/**
 * Shift the decimal point of a plain decimal numeral string by `exp` places and return the canonical form (no leading
 * zeros, no trailing fractional zeros): ("1.2", 9) -> "1200000000", ("1.2345", 3) -> "1234.5".
 */
export function shiftDecimal(num: string, exp: number): string {
  const [int = "0", frac = ""] = num.split(".");
  const digits = int + frac;
  const point = int.length + exp;
  let whole: string, rest: string;
  if (point >= digits.length) {
    whole = digits + "0".repeat(point - digits.length);
    rest = "";
  } else {
    whole = digits.slice(0, point);
    rest = digits.slice(point);
  }
  whole = whole.replace(/^0+(?=\d)/, "") || "0";
  rest = rest.replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : whole;
}

// One side of a value: an optional sign (leading side only), an optional "$", a numeral and an optional suffix.
const PART = String.raw`(\$)?(\d+(?:\.\d+)?)(%|x|×|K|k|M|B|bn)?`;
const VALUE = new RegExp(String.raw`^(-)?${PART}(?:-${PART})?$`);

interface Part {
  num: string;
  suffix: string | undefined;
}
interface Parsed {
  negative: boolean;
  /** A dollar amount: "$" on the first side (and, in a range, optionally the second). */
  dollars: boolean;
  parts: Part[];
}

function parse(value: string): Parsed | null {
  // normalizeNumberText folds digit sets, drops thousands separators, "26.8 %" -> "26.8%", every dash to "-".
  let n: string;
  try {
    n = normalizeNumberText(value);
  } catch {
    return null;
  }
  const m = VALUE.exec(n.replace(/\s+(?=[xK×kMBb%])/g, ""));
  if (!m) return null;
  const parts: Part[] = [{ num: m[3]!, suffix: m[4] }];
  if (m[6] !== undefined) parts.push({ num: m[6], suffix: m[7] });
  const dollars = m[2] === "$";
  // "$" only on the second side ("30-$40") is ambiguous; a dollar amount is never a percent or a multiplier.
  if (!dollars && m[5] === "$") return null;
  if (dollars && parts.some((x) => x.suffix === "%" || x.suffix === "x" || x.suffix === "×")) return null;
  return { negative: m[1] === "-", dollars, parts };
}

function renderPart(p: Part): string | null {
  const words = decimalToWords(p.num);
  if (words === null) return null;
  const scale = p.suffix !== undefined && p.suffix in SCALE_EXP;
  // "1,200K" would be "twelve hundred thousand": only a number below one thousand takes a scale suffix.
  if (scale && Number(p.num.split(".")[0]) >= 1000) return null;
  if (!p.suffix) return words;
  if (p.suffix === "%") return `${words} percent`;
  if (p.suffix === "x" || p.suffix === "×") return `${words} times`;
  return `${words} ${SCALE_WORD[p.suffix]}`;
}

/**
 * The value as a narrator says it, or null when it cannot be rendered exactly. Handles whole numbers up to the
 * billions (with thousands separators), decimals ("0.684" -> "zero point six eight four"), "%" ("percent"), a
 * multiplier "x" or "×" ("times"), the scale suffixes K/k, M, B/bn (thousand, million, billion), a leading minus
 * ("minus"), one range "a-b" ("a to b") and a dollar amount "$30" or "$1.2B-$2B" ("thirty dollars", "one point two
 * billion to two billion dollars"). Anything else (signs like ~ or <, units, leading zeros, ".5", lowercase
 * "m" or "b", numbers of 13 digits or more) returns null.
 */
export function spokenValue(value: string): string | null {
  const p = parse(value);
  if (!p) return null;
  const sides = p.parts.map(renderPart);
  if (sides.some((s) => s === null)) return null;
  const unit = p.dollars ? (p.parts.length === 1 && p.parts[0]!.num === "1" && !p.parts[0]!.suffix ? " dollar" : " dollars") : "";
  return (p.negative ? "minus " : "") + sides.join(" to ") + unit;
}

/** The value as printed in the record (whitespace collapsed). It was verified to be in the quote. */
export function screenValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The scaled numerals of a value with a K/M/B suffix ("1.2B" -> ["1200000000"]); empty for any other value. The
 * numerals() of "1.2B" is "1.2", so a narrator who says "one point two billion" is checked against both.
 */
export function scaledNumerals(value: string): string[] {
  const p = parse(value);
  if (!p) return [];
  return p.parts.flatMap((x) => (x.suffix !== undefined && x.suffix in SCALE_EXP ? [shiftDecimal(x.num, SCALE_EXP[x.suffix]!)] : []));
}
