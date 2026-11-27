import { test } from "node:test";
import assert from "node:assert/strict";
import { gold } from "./helpers.ts";
import { FullRecord } from "../lib/record.ts";

test("gold record parses", () => {
  assert.equal(FullRecord.safeParse(gold("2611.27106.record.json")).success, true);
});

test("schema rejects why_it_matters_for_justin at the top level", () => {
  const r = { ...gold("2611.27106.record.json"), why_it_matters_for_justin: "personal note" };
  assert.equal(FullRecord.safeParse(r).success, false);
});

test("schema rejects why_it_matters_for_justin inside compact", () => {
  const r = gold("2611.27106.record.json");
  r.compact.why_it_matters_for_justin = "personal note";
  assert.equal(FullRecord.safeParse(r).success, false);
});

test("schema requires depth full and a valid provenance", () => {
  const r = gold("2611.27106.record.json");
  r.compact.depth = "abstract";
  assert.equal(FullRecord.safeParse(r).success, false);
  const r2 = gold("2611.27106.record.json");
  r2.claims[0].provenance = "guess";
  assert.equal(FullRecord.safeParse(r2).success, false);
});

test("schema rejects duplicate quote ids and duplicate number ids", () => {
  const r = gold("2611.27106.record.json");
  r.quotes[1].id = "q1";
  assert.equal(FullRecord.safeParse(r).success, false);
  const r2 = gold("2611.27106.record.json");
  r2.numbers[1].id = "n1";
  assert.equal(FullRecord.safeParse(r2).success, false);
});

test("schema rejects dangling quote references", () => {
  for (const mutate of [
    (r: any) => (r.numbers[0].quote_id = "q99"),
    (r: any) => (r.claims[0].quote_ids = ["q99"]),
    (r: any) => (r.limits_authors[0].quote_id = "q99"),
  ]) {
    const r = gold("2611.27106.record.json");
    mutate(r);
    assert.equal(FullRecord.safeParse(r).success, false);
  }
});

test("compact.claim and compact.method may not be empty", () => {
  const r = gold("2611.27106.record.json");
  r.compact.claim = "";
  assert.equal(FullRecord.safeParse(r).success, false);
  const r2 = gold("2611.27106.record.json");
  r2.compact.method = "";
  assert.equal(FullRecord.safeParse(r2).success, false);
});
