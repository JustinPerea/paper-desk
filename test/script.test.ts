import { test } from "node:test";
import assert from "node:assert/strict";
import { gold, parseFixture } from "./helpers.ts";
import { FullRecord } from "../lib/record.ts";
import { applyVerification, verifyRecord } from "../lib/verify.ts";
import { Script, assembleScript, checkScript, estimateSeconds } from "../lib/script.ts";
import { ScriptOutput } from "../lib/script-schema.ts";

const verified = applyVerification(FullRecord.parse(gold("2611.27106.record.json")), verifyRecord(FullRecord.parse(gold("2611.27106.record.json")), parseFixture("2611.27106"))).record;
const script = (): Script => Script.parse(gold("2611.27106.script.json"));
const codes = (s: Script) => checkScript(s, verified).map((i) => i.code);

test("gold script passes", () => {
  const s = script();
  assert.deepEqual(checkScript(s, verified), []);
  const secs = estimateSeconds(s);
  assert.ok(secs >= 60 && secs <= 110, String(secs));
  assert.ok(s.beats.length >= 5 && s.beats.length <= 6);
});

test("invented number on screen fails", () => {
  const s = script();
  s.beats[3]!.on_screen = "0.684 schema validity, 0.77 quality";
  assert.ok(codes(s).includes("invented_on_screen_number"));
});

test("unknown number_ids entry fails", () => {
  const s = script();
  s.beats[3]!.number_ids.push("n42");
  assert.ok(codes(s).includes("unknown_number_id"));
});

test("a number_ids entry dropped by verification fails", () => {
  const rec = { ...verified, numbers: verified.numbers.filter((n) => n.id !== "n1") };
  assert.ok(checkScript(script(), rec).some((i) => i.code === "unknown_number_id" && /n1/.test(i.message)));
});

test("digits in narration fail", () => {
  const s = script();
  s.beats[2]!.narration = s.beats[2]!.narration.replace("five thousand four hundred", "5,400");
  assert.ok(codes(s).includes("digits_in_narration"));
});

test("a never-say word fails, default list and custom", () => {
  const s = script();
  s.beats[0]!.narration += " This is a breakthrough.";
  assert.ok(codes(s).includes("never_say"));
  const s2 = script();
  s2.beats[1]!.on_screen = "Revolutionary result";
  assert.ok(codes(s2).includes("never_say"));
  const s3 = script();
  s3.beats[0]!.narration += " Nobody proves this.";
  assert.ok(codes(s3).includes("never_say"));
});

test("too short fails", () => {
  const s = script();
  for (const b of s.beats) b.narration = b.narration.split(" ").slice(0, 12).join(" ");
  assert.ok(codes(s).includes("too_short"));
});

test("too long fails", () => {
  const s = script();
  s.beats[2]!.narration += " " + "word ".repeat(150);
  assert.ok(codes(s).includes("too_long"));
});

test("wrong beat order is rejected by the schema", () => {
  const raw = gold("2611.27106.script.json");
  [raw.beats[3], raw.beats[4]] = [raw.beats[4], raw.beats[3]];
  assert.equal(Script.safeParse(raw).success, false);
});

test("repeated non-method beat or wrong beat count is rejected; repeated method is allowed", () => {
  const raw = gold("2611.27106.script.json");
  assert.equal(Script.safeParse({ ...raw, beats: [...raw.beats.slice(0, 3), raw.beats[3], raw.beats[3], raw.beats[4]] }).success, false);
  assert.equal(Script.safeParse({ ...raw, beats: raw.beats.slice(0, 4) }).success, false);
  assert.equal(Script.safeParse({ ...raw, beats: [raw.beats[0], raw.beats[1], raw.beats[2], raw.beats[2], raw.beats[3], raw.beats[4]] }).success, true);
});

test("a spoofed script arxiv_id is flagged and no longer hides an invented number", () => {
  const s = script();
  s.paper.arxiv_id = "2611.99999";
  assert.ok(codes(s).includes("paper_mismatch"));
  const s2 = script();
  s2.paper.arxiv_id = "2611.26800"; // numerals 2611 and 26800 must not be exempted
  s2.beats[5]!.on_screen = "Shapiro et al. 2611.26800";
  const c = codes(s2);
  assert.ok(c.includes("paper_mismatch") && c.includes("invented_on_screen_number"));
});

test("schema requires a well-formed arxiv_id", () => {
  const raw = gold("2611.27106.script.json");
  raw.paper.arxiv_id = "26.8";
  assert.equal(Script.safeParse(raw).success, false);
});

test("Arabic-Indic numerals on screen are caught; folded values verify", () => {
  const s = script();
  s.beats[3]!.on_screen = "٢٦٫٨";
  assert.ok(codes(s).includes("invented_on_screen_number"));
  const s2 = script();
  s2.beats[3]!.on_screen = "٠٫٦٨٤"; // 0.684, verified
  assert.deepEqual(checkScript(s2, verified), []);
});

test("non-ASCII digits in narration are flagged", () => {
  const s = script();
  s.beats[0]!.narration += " ٢٦ percent.";
  assert.ok(codes(s).includes("digits_in_narration"));
  const s2 = script();
  s2.beats[0]!.narration += " २६ percent.";
  assert.ok(codes(s2).includes("digits_in_narration"));
});

test("a spoken number that matches a verified number passes", () => {
  const s = script();
  s.beats[3]!.narration += " Validity reached zero point six eight four."; // 0.684 is verified
  assert.ok(!codes(s).includes("unverified_spoken_number"), JSON.stringify(checkScript(s, verified)));
});

test("an invented spoken number fails, with the beat and value", () => {
  const s = script();
  s.beats[3]!.narration += " It reached eighty-one percent.";
  const hit = checkScript(s, verified).find((i) => i.code === "unverified_spoken_number");
  assert.ok(hit);
  assert.equal(hit.beat, 3);
  assert.match(hit.message, /81/);
});

test("small counts up to ten are allowed, eleven is not", () => {
  const s = script();
  s.beats[1]!.narration += " Two runs and ten tasks.";
  assert.ok(!codes(s).includes("unverified_spoken_number"));
  const s2 = script();
  s2.beats[1]!.narration += " Eleven runs.";
  assert.ok(codes(s2).includes("unverified_spoken_number"));
});

test("assembleScript fills paper from the record", () => {
  const { paper: _paper, ...out } = gold("2611.27106.script.json");
  const parsed = ScriptOutput.parse(out);
  const s = assembleScript(parsed, verified);
  assert.deepEqual(s.paper, { arxiv_id: verified.paper.arxiv_id, title: verified.paper.title });
  assert.deepEqual(checkScript(s, verified), []);
});

test("assembleScript rejects an out-of-order beat list", () => {
  const { paper: _paper, ...out } = gold("2611.27106.script.json");
  [out.beats[3], out.beats[4]] = [out.beats[4], out.beats[3]];
  assert.throws(() => assembleScript(out, verified));
});
