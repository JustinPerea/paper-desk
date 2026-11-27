import { numerals } from "./verify.ts";

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };
const isNumberWord = (w: string | undefined): boolean =>
  w !== undefined && (w in UNITS || w in TENS || w === "hundred" || w in SCALES);

/**
 * Every number a narrator would say, as numeral strings in the form numerals() produces: digits already in the
 * text plus English number words ("seventy-eight" -> "78", "zero point seven five" -> "0.75", "a hundred" -> "100").
 * Whole words only; ordinals and fractions ("third", "half") are not numbers here; "percent" does not change a value.
 */
export function spokenNumbers(text: string): string[] {
  const out = numerals(text);
  // Words, plus single punctuation/digit marks that break a number; hyphens and spaces join.
  const toks = text.toLowerCase().normalize("NFKC").match(/[a-z]+|[^a-z\s-]/g) ?? [];
  let i = 0;
  while (i < toks.length) {
    const start = i;
    let t = toks[i]!;
    let a = false;
    if (t === "a" && (toks[i + 1] === "hundred" || toks[i + 1]! in SCALES) && isNumberWord(toks[i + 1])) {
      a = true;
      i++;
      t = toks[i]!;
    }
    if (!isNumberWord(t) || (!a && (t === "hundred" || t in SCALES))) {
      i = start + 1;
      continue;
    }
    let total = 0;
    let cur = a ? 1 : 0;
    let last: "start" | "unit" | "tens" | "hundred" | "scale" = a ? "unit" : "start";
    let used = a;
    for (; i < toks.length; i++) {
      const w = toks[i]!;
      if (w in UNITS) {
        const u = UNITS[w]!;
        if (last === "start" || last === "hundred" || last === "scale") { cur += u; }
        else if (last === "tens" && u >= 1 && u <= 9) { cur += u; }
        else break;
        last = "unit";
      } else if (w in TENS) {
        if (last === "start" || last === "hundred" || last === "scale") { cur += TENS[w]!; last = "tens"; }
        else break;
      } else if (w === "hundred") {
        if ((last === "unit" || last === "tens") && cur > 0 && cur < 100) { cur *= 100; last = "hundred"; }
        else break;
      } else if (w in SCALES) {
        if (last === "unit" || last === "tens" || last === "hundred") { total += cur * SCALES[w]!; cur = 0; last = "scale"; }
        else break;
      } else if (w === "and" && (last === "hundred" || last === "scale") && isNumberWord(toks[i + 1]) && !(toks[i + 1]! in SCALES) && toks[i + 1] !== "hundred") {
        continue;
      } else break;
      used = true;
    }
    if (!used) { i = Math.max(i, start + 1); continue; }
    let value = String(total + cur);
    if (toks[i] === "point") {
      let j = i + 1;
      let frac = "";
      while (j < toks.length && toks[j]! in UNITS && UNITS[toks[j]!]! <= 9) frac += UNITS[toks[j++]!];
      if (frac) { value += "." + frac; i = j; }
    }
    out.push(value);
  }
  return out;
}
