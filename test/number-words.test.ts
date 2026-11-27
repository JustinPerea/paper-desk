import { test } from "node:test";
import assert from "node:assert/strict";
import { spokenNumbers } from "../lib/number-words.ts";

const say = (s: string) => spokenNumbers(s);

test("digits already in the text use the shared normalizer", () => {
  assert.deepEqual(say("It scored 78.5% on 1,000 tasks"), ["78.5", "1000"]);
});

test("units, teens and tens", () => {
  assert.deepEqual(say("zero"), ["0"]);
  assert.deepEqual(say("nineteen and twenty"), ["19", "20"]);
  assert.deepEqual(say("Ninety"), ["90"]);
});

test("hyphenated and spaced compounds", () => {
  assert.deepEqual(say("seventy-eight percent"), ["78"]);
  assert.deepEqual(say("forty two"), ["42"]);
  assert.deepEqual(say("twenty one, thirty"), ["21", "30"]);
});

test("adjacent separate numbers are not merged", () => {
  assert.deepEqual(say("three five"), ["3", "5"]);
  assert.deepEqual(say("twenty thirty"), ["20", "30"]);
});

test("hundred, thousand, million, billion and 'and'", () => {
  assert.deepEqual(say("one hundred and five"), ["105"]);
  assert.deepEqual(say("five thousand four hundred"), ["5400"]);
  assert.deepEqual(say("two million three hundred thousand"), ["2300000"]);
  assert.deepEqual(say("three billion"), ["3000000000"]);
  assert.deepEqual(say("twelve hundred"), ["1200"]);
  assert.deepEqual(say("one thousand and one"), ["1001"]);
});

test("'and' between two numbers does not join them", () => {
  assert.deepEqual(say("five and six"), ["5", "6"]);
});

test("a hundred and a thousand", () => {
  assert.deepEqual(say("a hundred runs"), ["100"]);
  assert.deepEqual(say("about a thousand papers"), ["1000"]);
});

test("decimals with point", () => {
  assert.deepEqual(say("seventy point two percent"), ["70.2"]);
  assert.deepEqual(say("zero point seven five"), ["0.75"]);
  assert.deepEqual(say("seventy-eight point five per cent"), ["78.5"]);
});

test("point without digit words after it adds nothing", () => {
  assert.deepEqual(say("the point is five. Point taken"), ["5"]);
  assert.deepEqual(say("ten point"), ["10"]);
});

test("case, punctuation and mixed digits and words", () => {
  assert.deepEqual(say("SEVENTY-EIGHT; and 12 more... (Two!)"), ["12", "78", "2"]);
});

test("ordinals and fractions are ignored", () => {
  assert.deepEqual(say("the first and third of a third, half of it"), []);
  assert.deepEqual(say("twenty first"), ["20"]);
});

test("bare 'hundred' or 'thousand' without a count is not a number", () => {
  assert.deepEqual(say("hundreds of thousands"), []);
  assert.deepEqual(say("hundred"), []);
});

test("words that merely contain a number word do not match", () => {
  assert.deepEqual(say("someone often saw tension in the network, nonetheless anyone phone stone bone tone"), []);
  assert.deepEqual(say("weight eighty-one"), ["81"]);
  assert.deepEqual(say("tenant fortune seventyish"), []);
});
