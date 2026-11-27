import { test } from "node:test";
import assert from "node:assert/strict";
import { integerToWords, scaledNumerals, screenValue, shiftDecimal, spokenValue } from "../lib/number-render.ts";
import { spokenNumbers } from "../lib/number-words.ts";
import { numerals } from "../lib/verify.ts";

test("integers become English words", () => {
  const cases: [number, string][] = [
    [0, "zero"], [7, "seven"], [10, "ten"], [13, "thirteen"], [20, "twenty"], [21, "twenty-one"], [99, "ninety-nine"],
    [100, "one hundred"], [101, "one hundred one"], [110, "one hundred ten"], [999, "nine hundred ninety-nine"],
    [1000, "one thousand"], [1001, "one thousand one"], [5400, "five thousand four hundred"], [12000, "twelve thousand"],
    [100000, "one hundred thousand"], [1_000_000, "one million"], [2_300_000, "two million three hundred thousand"],
    [3_000_000_000, "three billion"], [999_999_999_999, "nine hundred ninety-nine billion nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine"],
  ];
  for (const [n, w] of cases) assert.equal(integerToWords(n), w);
  assert.throws(() => integerToWords(1e12));
  assert.throws(() => integerToWords(-1));
});

test("spokenValue: numerals, decimals, percent, multipliers, scales, ranges", () => {
  const cases: [string, string][] = [
    ["5,400", "five thousand four hundred"],
    ["5400", "five thousand four hundred"],
    ["0.684", "zero point six eight four"],
    ["0.50", "zero point five zero"],
    ["26.8%", "twenty-six point eight percent"],
    ["26.8 %", "twenty-six point eight percent"],
    ["100%", "one hundred percent"],
    ["3x", "three times"],
    ["2.5×", "two point five times"],
    ["12K", "twelve thousand"],
    ["12k", "twelve thousand"],
    ["7M", "seven million"],
    ["1.2B", "one point two billion"],
    ["1.2bn", "one point two billion"],
    ["0.5M", "zero point five million"],
    ["0.91–0.94", "zero point nine one to zero point nine four"],
    ["0.91-0.94", "zero point nine one to zero point nine four"],
    ["10-20%", "ten to twenty percent"],
    ["−3.5", "minus three point five"],
    ["٠٫٦٨٤", "zero point six eight four"],
    ["２６", "twenty-six"],
    ["0", "zero"],
    ["999,999,999,999", integerToWords(999_999_999_999)],
    ["$30", "thirty dollars"],
    ["$1", "one dollar"],
    ["$1.00", "one point zero zero dollars"],
    ["$1,200", "one thousand two hundred dollars"],
    ["$1.2B", "one point two billion dollars"],
    ["$30-$40", "thirty to forty dollars"],
    ["$30–40", "thirty to forty dollars"],
    ["-$5", "minus five dollars"],
  ];
  for (const [v, w] of cases) assert.equal(spokenValue(v), w, v);
});

test("spokenValue returns null for anything it cannot render exactly", () => {
  for (const v of [
    "", "abc", "~5", "<5", ">=5", "+5", "5 ms", "5ms", "5m", "5b", "1,200K", ".5", "5.", "007", "00.5", "1e5", "1/2", "5-", "-", "1.2.3",
    "1,000,000,000,000", "0.1234567890123", "26.8 percent", "2026-11-26", "5 to 10", "5$", "$$5", "30-$40", "$5%", "$3x", "US$30", "€30", "$ 30x", "5%%", "x3", "five", "5 and 6", "1 000",
  ]) {
    assert.equal(spokenValue(v), null, JSON.stringify(v));
  }
});

test("screenValue returns the value as printed", () => {
  assert.equal(screenValue("26.8%"), "26.8%");
  assert.equal(screenValue("0.91–0.94"), "0.91–0.94");
  assert.equal(screenValue("5,400"), "5,400");
  assert.equal(screenValue("  26.8   % "), "26.8 %");
  assert.equal(screenValue("~5 ms"), "~5 ms");
});

test("shiftDecimal and scaledNumerals", () => {
  assert.equal(shiftDecimal("1.2", 9), "1200000000");
  assert.equal(shiftDecimal("1.2345", 3), "1234.5");
  assert.equal(shiftDecimal("0.5", 6), "500000");
  assert.equal(shiftDecimal("12", 3), "12000");
  assert.equal(shiftDecimal("0.001", 3), "1");
  assert.equal(shiftDecimal("1.20", 9), "1200000000");
  assert.deepEqual(scaledNumerals("1.2B"), ["1200000000"]);
  assert.deepEqual(scaledNumerals("12K"), ["12000"]);
  assert.deepEqual(scaledNumerals("1M-2M"), ["1000000", "2000000"]);
  assert.deepEqual(scaledNumerals("26.8%"), []);
  assert.deepEqual(scaledNumerals("~5"), []);
});

test("round trip: the narrator's words read back to the verified value (or its scaled value)", () => {
  const values = [
    "0", "1", "7", "10", "11", "19", "20", "21", "42", "99", "100", "101", "110", "199", "256", "999", "1000", "1001", "1100", "5,400",
    "12,345", "100,000", "1,000,000", "2,300,000", "3,000,000,000", "999,999,999,999",
    "0.1", "0.5", "0.50", "0.684", "0.638", "1.5", "26.8", "78.5", "100.25", "1,234.5678", "0.0", "0.05",
    "26.8%", "100%", "0.5%", "3x", "2.5×", "10×", "12K", "7k", "250M", "999B", "1.2B", "0.5M", "12.5K", "1.25bn",
    "0.91–0.94", "10-20%", "1,000-2,000", "5%-10%", "−3.5", "-12",
  ];
  for (const v of values) {
    const spoken = spokenValue(v);
    assert.ok(spoken !== null, v);
    const said = new Set(spokenNumbers(spoken!));
    const want = [...numerals(v), ...scaledNumerals(v)];
    for (const n of numerals(v)) {
      const scaled = scaledNumerals(v);
      assert.ok(said.has(n) || scaled.some((x) => said.has(x)), `${v} -> "${spoken}" read back ${[...said]} and wanted one of ${want}`);
    }
    // and nothing else: every number said is a numeral of the value or its scaled form
    for (const s of said) assert.ok(want.includes(s), `${v} -> "${spoken}" also said ${s}`);
  }
});

test("round trip, many integers", () => {
  for (let n = 0; n < 2000; n += 7) assert.deepEqual(spokenNumbers(integerToWords(n)), [String(n)]);
  for (const n of [12_345, 100_000, 100_001, 999_999, 1_000_000, 1_234_567, 20_000_000, 123_456_789, 1_000_000_000, 7_654_321_098]) {
    assert.deepEqual(spokenNumbers(integerToWords(n)), [String(n)], String(n));
  }
});
