import { test } from "node:test";
import assert from "node:assert/strict";
import { gold, parseFixture } from "./helpers.ts";
import { FullRecord } from "../lib/record.ts";
import { applyVerification, containsNumber, numerals, stripReported, verifyRecord } from "../lib/verify.ts";

const paper = parseFixture("2611.27106");
const base = () => FullRecord.parse(gold("2611.27106.record.json"));

test("gold record passes with everything ok", () => {
  const r = base();
  assert.ok(r.quotes.length >= 6 && r.numbers.length >= 3 && r.claims.length >= 3);
  const v = verifyRecord(r, paper);
  assert.ok(v.quotes.every((q) => q.status === "ok"), JSON.stringify(v.quotes));
  assert.ok(v.numbers.every((n) => n.status === "ok"));
  assert.ok(v.limits_authors.every((l) => l.status === "ok"));
  assert.equal(v.inference_claims, 1);
  assert.ok(v.all_ok);
  const applied = applyVerification(r, v);
  assert.deepEqual(applied.dropped, []);
  assert.deepEqual(applied.record, r);
});

test("fabricated quote is not_found", () => {
  const r = base();
  r.quotes[0]!.text = "schema validity guarantees correct answers in every workflow";
  assert.equal(verifyRecord(r, paper).quotes[0]!.status, "not_found");
});

test("real quote with the wrong anchor gives wrong_anchor and the right anchor", () => {
  const r = base();
  r.quotes[4]!.anchor = "S11.p3"; // q5 really lives in S11.p5
  const q = verifyRecord(r, paper).quotes[4]!;
  assert.equal(q.status, "wrong_anchor");
  assert.deepEqual(q.found_in, ["S11.p5"]);
});

test("missing anchor id gives anchor_missing", () => {
  const r = base();
  r.quotes[0]!.anchor = "S99.p1";
  assert.equal(verifyRecord(r, paper).quotes[0]!.status, "anchor_missing");
});

test("number missing from its quote fails; others stay ok", () => {
  const r = base();
  r.numbers[0]!.value = "0.999";
  const v = verifyRecord(r, paper);
  assert.equal(v.numbers[0]!.status, "value_not_in_quote");
  assert.equal(v.numbers[1]!.status, "ok");
});

test("a number is not matched inside a longer number", () => {
  const r = base();
  r.numbers[0]!.value = "0.68"; // prefix of 0.684
  assert.equal(verifyRecord(r, paper).numbers[0]!.status, "value_not_in_quote");
});

test("number tolerates thousands separators and percent spacing", () => {
  const r = base();
  r.numbers[3]!.value = "5400";
  assert.equal(verifyRecord(r, paper).numbers[3]!.status, "ok");
  assert.ok(containsNumber("accuracy rose to 26.8% overall", "26.8 %"));
  assert.ok(containsNumber("accuracy rose to 26.8 % overall", "26.8%"));
  assert.ok(containsNumber("n = 1,244 failures", "1244"));
  assert.ok(!containsNumber("n = 11,244 failures", "1,244"));
});

test("whitespace and curly-quote differences still pass", () => {
  const p = structuredClone(paper);
  p.abstract[0]!.text = "He said “parseable   output” is necessary – but it’s  not enough";
  const r = base();
  r.quotes = [{ id: "q1", text: 'said "parseable output" is necessary - but it\'s not\nenough', anchor: "abstract.p1", section_title: "Abstract" }];
  r.numbers = [];
  r.claims = [{ text: "x", quote_ids: ["q1"], provenance: "authors" }];
  r.limits_authors = [];
  assert.equal(verifyRecord(r, p).quotes[0]!.status, "ok");
});

test("matching is case-sensitive", () => {
  const r = base();
  r.quotes[0]!.text = r.quotes[0]!.text.toUpperCase();
  assert.equal(verifyRecord(r, paper).quotes[0]!.status, "not_found");
});

test("number whose quote failed is quote_not_ok", () => {
  const r = base();
  r.quotes[1]!.text = "invented sentence about 0.684";
  assert.equal(verifyRecord(r, paper).numbers[0]!.status, "quote_not_ok");
});

test("table text can anchor a quote", () => {
  const t = paper.tables.find((x) => x.text.length > 20)!;
  const r = base();
  const frag = t.caption.slice(0, 30);
  r.quotes = [{ id: "q1", text: frag, anchor: t.id, section_title: "" }];
  r.numbers = [];
  r.claims = [];
  r.limits_authors = [];
  assert.equal(verifyRecord(r, paper).quotes[0]!.status, "ok");
});

test("applyVerification drops failing items and what depends on them", () => {
  const r = base();
  r.quotes[1]!.text = "fabricated line mentioning 0.684 and 0.638"; // q2 -> n1, n2, claim 1
  r.quotes[0]!.anchor = "S99.p1"; // q1 -> claim 0
  r.numbers[3]!.value = "9,999"; // n4 value not in quote
  r.quotes[5]!.text = "The current human-audit packet is reviewed."; // q6 -> limit 1
  const v = verifyRecord(r, paper);
  const { record, dropped } = applyVerification(r, v);
  assert.deepEqual(record.quotes.map((q) => q.id), ["q3", "q4", "q5", "q7", "q8"]);
  assert.deepEqual(record.numbers.map((n) => n.id), ["n3"]);
  assert.equal(record.claims.length, 3); // two authors claims dropped; inference kept
  assert.ok(record.claims.some((c) => c.provenance === "inference"));
  assert.equal(record.limits_authors.length, 2);
  const key = dropped.map((d) => `${d.kind}:${d.id}`).sort();
  assert.deepEqual(key, ["claim:claim[0]", "claim:claim[1]", "limit:limits_authors[1]", "number:n1", "number:n2", "number:n4", "quote:q1", "quote:q2", "quote:q6", "result:compact.results[0]"]);
  // a re-verify of the cleaned record is clean
  assert.ok(verifyRecord(record, paper).all_ok);
});

test("an authors claim with one bad and one good quote keeps the good one", () => {
  const r = base();
  r.claims[0]!.quote_ids = ["q1", "q2"];
  r.quotes[1]!.text = "not in the paper at all";
  const { record } = applyVerification(r, verifyRecord(r, paper));
  assert.deepEqual(record.claims[0]!.quote_ids, ["q1"]);
});

// --- minimum quote size ---
test("trivial quotes are too_short and are dropped", () => {
  const r = base();
  r.quotes.push({ id: "q9", text: "0.684", anchor: "abstract.p3", section_title: "Abstract" });
  r.quotes.push({ id: "q10", text: "the model", anchor: "abstract.p3", section_title: "Abstract" });
  r.quotes.push({ id: "q11", text: "five words are not enough", anchor: "abstract.p3", section_title: "Abstract" });
  r.numbers.push({ id: "n9", value: "0.684", unit: "x", comparison: null, condition: null, quote_id: "q9" });
  const v = verifyRecord(r, paper);
  assert.deepEqual(v.quotes.slice(8).map((q) => q.status), ["too_short", "too_short", "too_short"]);
  assert.equal(v.numbers[4]!.status, "quote_not_ok");
  assert.equal(v.all_ok, false);
  const { record, dropped } = applyVerification(r, v);
  assert.ok(!record.quotes.some((q) => ["q9", "q10", "q11"].includes(q.id)));
  assert.ok(dropped.some((d) => d.id === "q9" && d.reason === "too_short"));
});

test("table quotes need 3 tokens, paragraph quotes need 6 words", () => {
  const t = paper.tables.find((x) => x.text.length > 20)!;
  const r = base();
  r.numbers = []; r.claims = []; r.limits_authors = [];
  r.quotes = [
    { id: "q1", text: t.caption.split(" ").slice(0, 2).join(" "), anchor: t.id, section_title: "" },
    { id: "q2", text: t.caption.split(" ").slice(0, 3).join(" "), anchor: t.id, section_title: "" },
  ];
  assert.deepEqual(verifyRecord(r, paper).quotes.map((q) => q.status), ["too_short", "ok"]);
});

// --- numerals in free text ---
const withText = (f: (r: ReturnType<typeof base>) => void) => {
  const r = base();
  f(r);
  return { r, v: verifyRecord(r, paper) };
};

test("gold record has no numeral issues", () => {
  assert.deepEqual(verifyRecord(base(), paper).numeral_issues, []);
});

test("unverified numerals in free-text fields are reported and fail all_ok", () => {
  const { r, v } = withText((r) => {
    r.compact.claim = "Quality rose 41 points.";
    r.compact.limits = "Tested in 2026.";
    r.change_for_agents = "Use 7 retries.";
    r.claims[1]!.text = "Validity was 0.99.";
    r.limits_authors[0]!.text = "Only 12 tasks.";
    r.compact.results[1]!.finding = "0.91–0.94 but also 88";
    r.numbers[3]!.condition = "run 3";
  });
  const key = v.numeral_issues.map((i) => `${i.field}=${i.numeral}`).sort();
  assert.deepEqual(key, [
    "change_for_agents=7", "claims[1].text=0.99", "compact.claim=41", "compact.limits=2026", "compact.results[1].finding=88",
    "limits_authors[0].text=12", "numbers[3].condition=3",
  ].sort());
  assert.equal(v.all_ok, false);
  const { record, dropped, reported } = applyVerification(r, v);
  assert.equal(record.compact.results.length, 1);
  assert.ok(!record.claims.some((c) => c.text.includes("0.99")));
  assert.equal(record.limits_authors.length, 2);
  assert.ok(!record.numbers.some((n) => n.id === "n4"));
  assert.equal(record.compact.claim, "Quality rose 41 points."); // single-string fields are left alone
  assert.deepEqual(reported.map((i) => i.field).sort(), ["change_for_agents", "compact.claim", "compact.limits"]);
  assert.ok(dropped.some((d) => d.kind === "result" && /88/.test(d.reason)));
});

test("numerals from ok quotes and verified numbers are allowed; years get no carve-out; the paper's arXiv id is allowed", () => {
  const { v } = withText((r) => {
    r.claims[0]!.text = "Rows: 5400, validity 0.684, mean 0.91 to 0.94. See 2611.27106.";
  });
  assert.deepEqual(v.numeral_issues, []);
  const y = withText((r) => (r.change_for_agents = "Published in 2026."));
  assert.equal(y.v.numeral_issues[0]!.numeral, "2026");
});

test("a numeral supported only by a failed quote is not allowed", () => {
  const { v } = withText((r) => {
    r.quotes[4]!.text = "Results do not generalize to 77 invented settings in this study.";
    r.claims[0]!.text = "It covers 77 settings.";
  });
  assert.ok(v.numeral_issues.some((i) => i.numeral === "77"));
});

test("non-ASCII digits are folded for numeral checks and number matching", () => {
  const { v } = withText((r) => (r.change_for_agents = "Use ٧ retries."));
  assert.deepEqual(v.numeral_issues.map((i) => i.numeral), ["7"]);
  const r = base();
  r.numbers[0]!.value = "٠٫٦٨٤"; // Arabic-Indic 0.684
  assert.equal(verifyRecord(r, paper).numbers[0]!.status, "ok");
});

test("a record naming a different paper or version fails, and its id no longer exempts numerals", () => {
  const r = base();
  r.paper.arxiv_id = "2611.99999";
  r.compact.claim += " 2611.99999";
  const v = verifyRecord(r, paper);
  assert.equal(v.paper_match, false);
  assert.equal(v.all_ok, false);
  assert.ok(v.numeral_issues.some((i) => i.field === "compact.claim"), "the spoofed id is checked like any other numeral");
  const w = base();
  w.paper.version = "v2";
  assert.equal(verifyRecord(w, paper).paper_match, false);
  assert.equal(verifyRecord(base(), paper).paper_match, true);
});

test("digits from every set fold to their real value, including back-to-back mathematical digits", async () => {
  const { normalizeNumberText } = await import("../lib/verify.ts");
  // U+1D7D8 is MATHEMATICAL DOUBLE-STRUCK DIGIT ZERO, right after bold nine; U+1D7E1 is double-struck nine.
  assert.equal(normalizeNumberText("\u{1D7D8}\u{1D7E1}"), "09");
  assert.equal(normalizeNumberText("２６.８"), "26.8"); // fullwidth
  assert.equal(normalizeNumberText("٢٦٫٨"), "26.8"); // Arabic-Indic
  assert.equal(normalizeNumberText("२६"), "26"); // Devanagari
  assert.equal(normalizeNumberText("\u{1E950}\u{1E959}"), "09"); // Adlam
});

test("one tokenizer: a comma that is not a thousands separator splits numbers", () => {
  assert.deepEqual(numerals("groups 1,2 and 3"), ["1", "2", "3"]);
  assert.deepEqual(numerals("n = 1,234,567"), ["1234567"]);
  assert.deepEqual(numerals("0.91–0.94"), ["0.91", "0.94"]);
});

test("a number value must match whole numerals of its quote on both sides", () => {
  assert.ok(!containsNumber("rose to 10.5 points", ".5"));
  assert.ok(!containsNumber("rose to 10.5 points", "0.5"));
  assert.ok(!containsNumber("accuracy 26.8%", "26"));
  assert.ok(!containsNumber("groups 1,2 and 3", "12"));
  assert.ok(containsNumber("mean quality 0.91–0.94, while", "0.91–0.94"));
});

test("every string field is scanned, not only a fixed list", () => {
  const { r, v } = withText((r) => {
    r.compact.method = "Ran 9 seeds.";
    r.likely_overclaims.push("Beats humans by 30 points.");
    r.compact.applies_to.push("agents with 64 tools");
    r.numbers[0]!.unit = "x 1000";
    r.named_people.push("Agent 47");
  });
  const key = v.numeral_issues.map((i) => `${i.field}=${i.numeral}`).sort();
  assert.ok(key.includes("compact.method=9"), key.join(" "));
  assert.ok(key.some((k) => k.startsWith("likely_overclaims[") && k.endsWith("=30")));
  assert.ok(key.some((k) => k.startsWith("compact.applies_to[") && k.endsWith("=64")));
  assert.ok(key.includes("numbers[0].unit=1000"));
  assert.ok(key.some((k) => k.startsWith("named_people[") && k.endsWith("=47")));
  assert.equal(v.all_ok, false);
  const { record, reported } = applyVerification(r, v);
  assert.ok(!record.likely_overclaims.some((o) => o.includes("30")));
  assert.ok(!record.compact.applies_to.some((a) => a.includes("64")));
  assert.ok(!record.named_people.includes("Agent 47"));
  assert.ok(!record.numbers.some((n) => n.unit === "x 1000"));
  assert.ok(reported.some((i) => i.field === "compact.method"));
});

test("paper metadata fields may use numerals from the parsed page, prose fields may not", () => {
  const ok = withText((r) => {
    r.compact.results[0]!.location = "Table 7 (S8.T7)";
    r.quotes[0]!.section_title = "Abstract";
  });
  assert.deepEqual(ok.v.numeral_issues, []);
  const bad = withText((r) => {
    r.compact.results[0]!.location = "Table 99";
    r.compact.claim = "See Table 7.";
  });
  const key = bad.v.numeral_issues.map((i) => `${i.field}=${i.numeral}`).sort();
  assert.deepEqual(key, ["compact.claim=7", "compact.results[0].location=99"]);
});

test("stripReported removes sentences with unverified numerals so the record verifies clean", () => {
  const r = base();
  const keepClaim = r.compact.claim;
  const keepChange = r.change_for_agents;
  assert.ok(keepClaim && keepChange);
  r.compact.claim = `${keepClaim} It also gained 97.3 points on a hidden set.`;
  r.change_for_agents = `${keepChange} Expect a 91.7% drop in retries.`;
  r.compact.limits = "Only 99.1 percent of cases were tested.";
  const first = verifyRecord(r, paper);
  assert.equal(first.all_ok, false);
  const applied = applyVerification(r, first);
  assert.ok(applied.reported.length >= 3);
  const stripped = stripReported(applied.record, applied.reported);
  assert.equal(applied.record.compact.claim, r.compact.claim, "input not mutated");
  const second = verifyRecord(stripped, paper);
  assert.deepEqual(second.numeral_issues, []);
  assert.ok(second.all_ok);
  assert.equal(stripped.compact.claim, keepClaim);
  assert.equal(stripped.change_for_agents, keepChange);
  assert.equal(stripped.compact.limits, null);
});

test("stripReported blanks a required string when nothing is left", () => {
  const r = base();
  r.compact.method = "We ran 88.8 trials.";
  const applied = applyVerification(r, verifyRecord(r, paper));
  const stripped = stripReported(applied.record, applied.reported);
  assert.equal(stripped.compact.method, "");
});

test("invariant: strip(apply(gold)) verifies all_ok", () => {
  const r = base();
  const applied = applyVerification(r, verifyRecord(r, paper));
  const stripped = stripReported(applied.record, applied.reported);
  assert.deepEqual(stripped, r);
  assert.ok(verifyRecord(stripped, paper).all_ok);
});
