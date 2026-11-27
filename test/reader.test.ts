import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { gold, parseFixture } from "./helpers.ts";
import { FullRecord } from "../lib/record.ts";
import { verifyRecord } from "../lib/verify.ts";
import { assembleRecord, licenseFromAbsHtml, paperForReader, ReaderOutput, repairMessage } from "../lib/reader.ts";

const paper = parseFixture("2611.27106");
const meta = { url: "https://arxiv.org/abs/2611.27106v1", license: "https://creativecommons.org/licenses/by/4.0/", read_at: "2026-11-26T05:00:00Z" };
const out = () => ReaderOutput.parse(gold("2611.27106.record.json"));

test("ReaderOutput drops paper and the code-set fields", () => {
  const o = out() as Record<string, any>;
  assert.equal(o.paper, undefined);
  assert.equal(o.compact.license, undefined);
  assert.equal(o.compact.depth, undefined);
  assert.equal(o.quotes[0].section_title, undefined);
});

test("paperForReader prefixes every block with id and section", () => {
  const { text, truncated } = paperForReader(paper);
  assert.equal(truncated, false);
  assert.ok(text.startsWith(`Title: ${paper.title}\nAuthors: `));
  assert.match(text, /\[abstract\.p1\] \(Abstract\) /);
  const p = paper.paragraphs.find((x) => x.id === "S11.p5")!;
  assert.ok(text.includes(`[S11.p5] (${p.section_title}) ${p.text}`));
  for (const t of paper.tables) assert.ok(text.includes(`[${t.id}] (Table) ${t.caption}\n${t.text}`));
  assert.ok(text.indexOf("[abstract.p1]") < text.indexOf("[S11.p5]"));
});

test("paperForReader stops at a block boundary and flags truncation", () => {
  const { text, truncated } = paperForReader(paper, 3000);
  assert.equal(truncated, true);
  assert.ok(text.length <= 3000);
  assert.ok(text.endsWith("\n"));
  const blocks = text.split("\n").filter((l) => l.startsWith("["));
  for (const b of blocks) {
    const id = b.slice(1, b.indexOf("]"));
    const p = [...paper.abstract, ...paper.paragraphs].find((x) => x.id === id);
    assert.ok(p && b.endsWith(p.text), `block ${id} is cut`);
  }
});

test("assembleRecord takes the paper from code and fills section titles", () => {
  const o = out();
  const r = assembleRecord(o, paper, meta);
  assert.equal(r.paper.title, paper.title);
  assert.deepEqual(r.paper.authors_as_printed, paper.authors_as_printed);
  assert.deepEqual(r.paper.affiliations, []);
  assert.equal(r.paper.arxiv_id, "2611.27106");
  assert.equal(r.paper.version, "v1");
  assert.equal(r.paper.source, "html");
  assert.equal(r.paper.url, meta.url);
  assert.equal(r.paper.license, meta.license);
  assert.equal(r.paper.read_at, meta.read_at);
  assert.equal(r.compact.license, meta.license);
  assert.equal(r.compact.depth, "full");
  assert.equal(r.quotes.find((q) => q.anchor === "abstract.p1")!.section_title, "Abstract");
  const body = r.quotes.find((q) => q.anchor === "S11.p5")!;
  assert.equal(body.section_title, paper.paragraphs.find((p) => p.id === "S11.p5")!.section_title);
  assert.equal(FullRecord.safeParse(r).success, true);
  assert.ok(verifyRecord(r, paper).all_ok);
});

test("assembleRecord ignores a section_title the model supplied", () => {
  const o = out();
  (o.quotes[0] as any).section_title = "Made up";
  assert.equal(assembleRecord(o, paper, meta).quotes[0]!.section_title, "Abstract");
});

test("assembleRecord throws ZodError on a dangling quote id", () => {
  const o = out();
  o.claims[0]!.quote_ids = ["q99"];
  assert.throws(() => assembleRecord(o, paper, meta), ZodError);
});

test("assembleRecord rejects a personal field passed through", () => {
  const o = { ...out(), why_it_matters_for_justin: "personal note" } as ReaderOutput;
  assert.throws(() => assembleRecord(o, paper, meta), ZodError);
});

test("repairMessage is null on a clean result", () => {
  const r = assembleRecord(out(), paper, meta);
  assert.equal(repairMessage(verifyRecord(r, paper), r), null);
});

test("repairMessage lists each kind of failure", () => {
  const r = assembleRecord(out(), paper, meta);
  r.quotes[4]!.anchor = "S11.p3"; // really in S11.p5: wrong_anchor with found_in
  r.quotes[0]!.text = "schema validity guarantees correct answers in every workflow"; // not_found
  r.numbers[0]!.value = "0.999";
  r.claims[0]!.text = "A claim citing 7777 runs";
  r.limits_authors[0]!.quote_id = r.quotes[0]!.id;
  const v = verifyRecord(r, paper);
  const msg = repairMessage(v, r)!;
  assert.ok(msg);
  assert.match(msg, /q1: not_found/);
  assert.match(msg, /q5: wrong_anchor; the text was found under S11\.p5/);
  assert.match(msg, new RegExp(`${r.numbers[0]!.id}: (value_not_in_quote|quote_not_ok)`));
  assert.match(msg, /claims\[0\]\.text: 7777/);
  assert.match(msg, /limits_authors\[\d+\]: quote_not_ok/);
  assert.match(msg, /full corrected output/);
});

test("licenseFromAbsHtml reads the abs-license link and upgrades to https", () => {
  const html = readFileSync(fileURLToPath(new URL("./fixtures/abs-2611.27106.html", import.meta.url)), "utf8");
  assert.equal(licenseFromAbsHtml(html), "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(licenseFromAbsHtml("<html><body>no license</body></html>"), null);
  assert.equal(licenseFromAbsHtml('<div class="abs-license"><a href="javascript:alert(1)">x</a></div>'), null);
});
