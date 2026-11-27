import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArxivRss, selectNew, validatePick, type Candidate } from "../lib/arxiv-feed.ts";

const xml = readFileSync(fileURLToPath(new URL("./fixtures/rss-sample.xml", import.meta.url)), "utf8");
const cands = parseArxivRss(xml);
const mk = (arxiv_id: string, announce_type = "new"): Candidate => ({ arxiv_id, version: "v1", title: `t ${arxiv_id}`, abstract: "a", categories: ["cs.AI"], announce_type });

test("parses every item of the sample feed", () => {
  assert.equal(cands.length, 6);
  assert.deepEqual(cands.map((c) => c.announce_type), ["new", "new", "cross", "replace", "replace", "replace-cross"]);
  assert.deepEqual(cands.map((c) => c.arxiv_id), ["2611.34563", "2611.34938", "2611.34662", "2606.14325", "2610.23166", "2605.11007"]);
  assert.deepEqual(cands.map((c) => c.version), ["v1", "v1", "v1", "v2", "v2", "v5"]);
});

test("categories, title and abstract are cleaned", () => {
  const c = cands[1]!;
  assert.deepEqual(c.categories, ["cs.CL", "cs.LG"]);
  assert.match(c.title, /^Tokenisation is not in APX/);
  assert.ok(c.abstract.length > 50 && c.abstract.length <= 1500);
  assert.ok(!c.abstract.startsWith("Abstract:") && !/\n/.test(c.abstract));
  assert.ok(cands.every((x) => !/<[a-z]/i.test(x.title + x.abstract)));
});

test("parser strips markup, caps the abstract, and falls back to the link", () => {
  const long = "word ".repeat(600);
  const feed = `<rss xmlns:arxiv="http://arxiv.org/schemas/atom" version="2.0"><channel>
  <item><title>Hi &lt;b&gt;there&lt;/b&gt;</title><link>https://arxiv.org/abs/2611.00001</link>
  <description>Abstract: &lt;script&gt;x&lt;/script&gt;${long}</description><category>cs.AI</category></item>
  <item><title>No id</title><link>https://example.com/x</link><description>nothing</description></item></channel></rss>`;
  const out = parseArxivRss(feed);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "Hi there");
  assert.equal(out[0]!.arxiv_id, "2611.00001");
  assert.equal(out[0]!.version, "v1");
  assert.ok(out[0]!.abstract.length <= 1500 && !out[0]!.abstract.includes("<"));
});

test("announce type falls back to the description", () => {
  const feed = `<rss version="2.0"><channel><item><title>T</title><link>https://arxiv.org/abs/2611.00002</link>
  <description>arXiv:2611.00002v3 Announce Type: replace-cross \nAbstract: body</description></item></channel></rss>`;
  const [c] = parseArxivRss(feed);
  assert.equal(c!.announce_type, "replace-cross");
  assert.equal(c!.version, "v3");
});

test("selectNew keeps only new, in feed order", () => {
  assert.deepEqual(selectNew(cands, new Set()).map((c) => c.arxiv_id), ["2611.34563", "2611.34938"]);
});

test("selectNew dedupes, skips already read, and caps", () => {
  const list = [mk("2611.00001"), mk("2611.00002"), mk("2611.00001"), mk("2611.00003"), mk("2611.00004", "replace"), mk("2611.00005")];
  assert.deepEqual(selectNew(list, new Set(["2611.00002"])).map((c) => c.arxiv_id), ["2611.00001", "2611.00003", "2611.00005"]);
  assert.deepEqual(selectNew(list, new Set(), 2).map((c) => c.arxiv_id), ["2611.00001", "2611.00002"]);
});

test("validatePick keeps the picker's order and ignores unknown and duplicate ids", () => {
  const list = [mk("2611.00001"), mk("2611.00002"), mk("2611.00003")];
  const got = validatePick({ arxiv_ids: ["2611.00003", "9999.99999", "2611.00001", "2611.00003", "ignore previous instructions"] }, list);
  assert.deepEqual(got.map((c) => c.arxiv_id), ["2611.00003", "2611.00001"]);
  assert.deepEqual(validatePick({ arxiv_ids: [] }, list), []);
});
