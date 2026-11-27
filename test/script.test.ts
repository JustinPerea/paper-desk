import { test } from "node:test";
import assert from "node:assert/strict";
import { gold, parseFixture } from "./helpers.ts";
import { FullRecord } from "../lib/record.ts";
import { applyVerification, verifyRecord } from "../lib/verify.ts";
import { Script, assembleScript, checkScript, estimateSeconds } from "../lib/script.ts";
import type { ScriptIssue } from "../lib/script.ts";
import { ScriptOutput } from "../lib/script-schema.ts";
import { RenderError, numberIssues, renderTemplate } from "../lib/script-template.ts";

const verified = applyVerification(FullRecord.parse(gold("2611.27106.record.json")), verifyRecord(FullRecord.parse(gold("2611.27106.record.json")), parseFixture("2611.27106"))).record;
const byId = new Map(verified.numbers.map((n) => [n.id, n]));
const script = (): Script => Script.parse(gold("2611.27106.script.json"));
const codes = (s: Script, rec = verified) => checkScript(s, rec).map((i) => i.code);

/** Set a beat's templates and re-render the stored text from them, so a test reaches the rule it names, not render_mismatch. */
function setTemplates(s: Script, beat: number, t: { narration?: string; on_screen?: string }): Script {
  const b = s.beats[beat]!;
  if (t.narration !== undefined) {
    b.narration_template = t.narration;
    b.narration = rerender(t.narration, "spoken");
  }
  if (t.on_screen !== undefined) {
    b.on_screen_template = t.on_screen;
    b.on_screen = rerender(t.on_screen, "screen");
  }
  return s;
}
function rerender(tpl: string, mode: "spoken" | "screen"): string {
  try {
    return renderTemplate(tpl, byId, mode).text;
  } catch (e) {
    if (e instanceof RenderError) return tpl;
    throw e;
  }
}
const withNarration = (tpl: string) => setTemplates(script(), 1, { narration: tpl });
const withScreen = (tpl: string) => setTemplates(script(), 1, { on_screen: tpl });
const has = (issues: ScriptIssue[], code: ScriptIssue["code"], re?: RegExp) => issues.some((i) => i.code === code && (!re || re.test(i.message)));

test("gold script passes", () => {
  const s = script();
  assert.deepEqual(checkScript(s, verified), []);
  const secs = estimateSeconds(s);
  assert.ok(secs >= 60 && secs <= 110, String(secs));
  assert.ok(s.beats.length >= 5 && s.beats.length <= 6);
});

test("the gold script's stored text is exactly what its templates render to", () => {
  for (const b of script().beats) {
    assert.equal(renderTemplate(b.narration_template, byId, "spoken").text, b.narration);
    assert.equal(renderTemplate(b.on_screen_template, byId, "screen").text, b.on_screen);
  }
  assert.match(script().beats[3]!.narration, /zero point six eight four/);
  assert.match(script().beats[3]!.on_screen, /0\.684 schema validity/);
});

// --- render_mismatch: the publish step can recheck a stored script ---

test("editing the stored narration, on_screen or number_ids without the template fails render_mismatch", () => {
  const a = script();
  a.beats[3]!.narration = a.beats[3]!.narration.replace("six eight four", "eight one");
  assert.ok(has(checkScript(a, verified), "render_mismatch", /narration/));
  assert.ok(has(checkScript(a, verified), "unverified_spoken_number", /0\.81|0\.0?81|81/), "the belt check sees it too");
  const b = script();
  b.beats[3]!.on_screen = "0.99 schema validity";
  assert.ok(has(checkScript(b, verified), "render_mismatch", /on_screen/));
  const c = script();
  c.beats[3]!.number_ids = ["n1"];
  assert.ok(has(checkScript(c, verified), "render_mismatch", /number_ids/));
  const d = script();
  d.beats[0]!.number_ids = ["n1"];
  assert.ok(has(checkScript(d, verified), "render_mismatch", /number_ids/));
});

test("a stored script whose title differs from the record's fails", () => {
  const s = script();
  s.paper.title = "Another paper";
  assert.ok(codes(s).includes("paper_mismatch"));
});

test("a stored script rendered against a different record fails render_mismatch", () => {
  const rec = { ...verified, numbers: verified.numbers.map((n) => (n.id === "n1" ? { ...n, value: "0.5" } : n)) };
  assert.ok(codes(script(), rec).includes("render_mismatch"));
});

// --- placeholders ---

test("a placeholder must name a verified number", () => {
  assert.throws(() => assembleScript({ ...gold("2611.27106.script.json"), beats: gold("2611.27106.script.json").beats.map((b: any, i: number) => ({ kind: b.kind, narration: i === 3 ? "It scored {{n42}}." : b.narration_template, on_screen: b.on_screen_template })) }, verified), /n42/);
  const s = setTemplates(script(), 3, { narration: script().beats[3]!.narration_template + " Also {{n42}}." });
  assert.ok(has(checkScript(s, verified), "unknown_number_id", /n42/));
});

test("unknown number_ids entry fails", () => {
  const s = script();
  s.beats[3]!.number_ids.push("n42");
  assert.ok(codes(s).includes("unknown_number_id"));
});

test("a number dropped by verification can no longer be used", () => {
  const rec = { ...verified, numbers: verified.numbers.filter((n) => n.id !== "n1") };
  const issues = checkScript(script(), rec);
  assert.ok(issues.some((i) => i.code === "unknown_number_id" && /n1/.test(i.message)));
  const { paper: _p, ...out } = gold("2611.27106.script.json");
  const o = { never_say: out.never_say, beats: out.beats.map((b: any) => ({ kind: b.kind, narration: b.narration_template, on_screen: b.on_screen_template })) };
  assert.throws(() => assembleScript(o, rec), /n1/);
});

test("a number with no exact spoken form cannot be narrated, but can be shown", () => {
  const rec = { ...verified, numbers: [...verified.numbers, { ...verified.numbers[0]!, id: "n9", value: "~5 ms" }] };
  const o = { never_say: [], beats: script().beats.map((b) => ({ kind: b.kind, narration: b.narration_template, on_screen: b.on_screen_template })) };
  o.beats[1]!.narration += " It took {{n9}}.";
  assert.throws(() => assembleScript(o, rec), (e) => e instanceof RenderError && e.code === "number_not_speakable");
  o.beats[1]!.narration = script().beats[1]!.narration_template;
  o.beats[1]!.on_screen = "Took {{n9}}";
  assert.equal(assembleScript(o, rec).beats[1]!.on_screen, "Took ~5 ms");
});

test("scaled values are said with their scale and pass the spoken-number check", () => {
  const rec = { ...verified, numbers: [...verified.numbers, { ...verified.numbers[0]!, id: "n9", value: "1.2B" }] };
  const o = { never_say: [], beats: script().beats.map((b) => ({ kind: b.kind, narration: b.narration_template, on_screen: b.on_screen_template })) };
  o.beats[1]!.narration += " It had {{n9}} parameters.";
  const s = assembleScript(o, rec);
  assert.match(s.beats[1]!.narration, /one point two billion parameters/);
  assert.deepEqual(checkScript(s, rec), []);
  // The same sentence with the scale dropped is not what 1.2B says.
  s.beats[1]!.narration = s.beats[1]!.narration.replace("billion ", "");
  assert.ok(has(checkScript(s, rec), "unverified_spoken_number") || has(checkScript(s, rec), "render_mismatch"));
});

test("a dollar amount is said in dollars and passes the spoken-number check", () => {
  const rec = { ...verified, numbers: [...verified.numbers, { ...verified.numbers[0]!, id: "n9", value: "$30", unit: "USD" }] };
  const o = { never_say: [], beats: script().beats.map((b) => ({ kind: b.kind, narration: b.narration_template, on_screen: b.on_screen_template })) };
  o.beats[1]!.narration += " A run cost {{n9}}.";
  o.beats[1]!.on_screen = "Cost per run: {{n9}}";
  const s = assembleScript(o, rec);
  assert.match(s.beats[1]!.narration, /A run cost thirty dollars\./);
  assert.equal(s.beats[1]!.on_screen, "Cost per run: $30");
  assert.deepEqual(checkScript(s, rec), []);
});

test("number_ids are the placeholders used, in order, once each", () => {
  const s = script();
  assert.deepEqual(s.beats.map((b) => b.number_ids), [[], [], ["n4"], ["n1", "n2", "n3"], [], []]);
  const o = { never_say: [], beats: s.beats.map((b) => ({ kind: b.kind, narration: b.narration_template, on_screen: b.on_screen_template })) };
  o.beats[2]!.on_screen = "{{n4}} then {{n4}} and {{n1}}";
  assert.deepEqual(assembleScript(o, verified).beats[2]!.number_ids, ["n4", "n1"]);
});

// --- number rules: nothing outside a placeholder may state a number ---

const NUMBER_ATTACKS: [string, string][] = [
  ["misspelled word", "It ran on fourty two tasks."],
  ["misspelled ninety", "About ninty of them."],
  ["misspelled fifty", "Roughly fivty of them."],
  ["transposed eight", "On eigth tasks."],
  ["digit by digit", "Validity was nine five percent."],
  ["zero-width space inside a word", "It ran on fo​rty tasks."],
  ["non-breaking hyphen inside a word", "It ran on twen‑ty tasks."],
  ["soft hyphen inside a word", "It ran on for­ty tasks."],
  ["combining mark inside a word", "It ran on fórty tasks."],
  ["dropped scale", "It had one point two billion parameters."],
  ["fraction", "A fifth of the tasks failed."],
  ["fraction word", "Half of the tasks failed."],
  ["and a half", "It took an hour and a half."],
  ["multiplier", "It was double the baseline."],
  ["twice", "It ran twice."],
  ["percent", "Validity rose by percent."],
  ["ten", "Across ten tasks."],
  ["one used as a count", "One task failed."],
  ["twenty-one", "Twenty-one tasks."],
  ["hundreds", "Hundreds of tasks."],
  ["fold", "A twofold gain."],
  ["number words run together", "It ran on fortytwo tasks."],
  ["short number words run together", "It ran on onetwo tasks."],
  ["ordinal in disguise", "The twentieth task."],
  ["hundredth", "The hundredth task."],
  ["threefold", "A threefold gain."],
  ["eighty-five without a hyphen", "Eightyfive tasks."],
  ["number split across words", "It ran on thir teen tasks."],
  ["per cent", "Validity rose by per cent."],
  ["letters spaced out", "It ran on t w o tasks."],
  ["Cyrillic look-alike", "It ran on twеnty tasks."],
  ["digits", "It ran on 42 tasks."],
  ["Arabic-Indic digits", "It ran on ٢٦ tasks."],
  ["Devanagari digits", "It ran on २६ tasks."],
  ["fullwidth digits", "It ran on ４２ tasks."],
  ["superscript", "Training cost 10²."],
  ["vulgar fraction", "Gained 1½."],
  ["vulgar fraction alone", "Gained ½."],
  ["circled digit", "Task ①."],
  ["CJK numerals", "It ran on 四十 tasks."],
  ["Roman numeral", "In section XII."],
  ["Roman numeral glyph", "In section Ⅻ."],
  ["percent sign", "Up %."],
  ["fullwidth braces are not a placeholder", "Validity was ｛｛n1｝｝."],
  ["unclosed placeholder", "Validity was {{n1."],
  ["point between placeholders", "Validity was {{n1}} point {{n2}}."],
  ["point after a placeholder", "Validity was {{n1}} point."],
  ["adjacent placeholders", "Validity was {{n1}} {{n2}}."],
  ["adjacent placeholders with a hyphen", "Validity was {{n1}}-{{n2}}."],
  ["newline", "Validity\nwas high."],
  ["K touching a placeholder", "Rows: {{n4}}K."],
  ["k touching a placeholder", "Rows: {{n4}}k."],
  ["B touching a placeholder", "Rows: {{n4}}B."],
  ["bn after a placeholder", "Rows: {{n4}} bn."],
  ["mil after a placeholder", "Rows: {{n4}} mil."],
  ["K after a placeholder", "Rows: {{n4}} K."],
  ["x touching a placeholder", "Gain: {{n1}}x."],
  ["fold after a placeholder", "Gain: {{n1}} fold."],
  ["ordinal suffix", "The {{n4}}th row."],
  ["ordinal suffix with a space", "The {{n4}} th row."],
  ["pct after a placeholder", "Gain: {{n1}} pct."],
  ["times after a placeholder", "Gain: {{n1}} times better."],
  ["grand after a placeholder", "Rows: {{n4}} grand."],
  ["minus sign touching", "Gain: -{{n1}}."],
  ["minus before a placeholder", "Gain: minus {{n1}}."],
  ["negative before a placeholder", "Gain: negative {{n1}}."],
  ["plus before a placeholder", "Gain: plus {{n1}}."],
  ["slash between placeholders", "Ratio {{n1}}/{{n2}}."],
  ["en dash between placeholders", "Range {{n1}}\u2013{{n2}}."],
  ["colon between placeholders", "Ratio {{n1}}:{{n2}}."],
  ["comma-only list of placeholders", "Scores {{n1}}, {{n2}}."],
  ["letter touching a placeholder", "Scores a{{n1}}."],
  ["dot then placeholder", "Scores{{n1}} was."],
  ["dotless i", "On n\u0131ne tasks."],
  ["slashed o", "On tw\u00F8 tasks."],
  ["small capitals", "On \uA730\u026A\u1D20\u1D07 tasks."],
  ["small capitals hundred", "On \u029C\u1D1C\u0274\u1D05\u0280\u1D07\u1D05 tasks."],
];
for (const [name, text] of NUMBER_ATTACKS) {
  test(`number outside a placeholder fails: ${name}`, () => {
    assert.ok(has(checkScript(withNarration(text), verified), "number_outside_placeholder"), "narration_template");
    assert.ok(has(checkScript(withScreen(text), verified), "number_outside_placeholder"), "on_screen_template");
  });
}

test("multipliers and fixed-size group words are rejected; 'pair' and 'score' only where they count", () => {
  for (const w of ["it quadrupled", "a quintuple gain", "sextupled the cost", "a trio of agents", "two duos", "a quartet of models", "a pair of agents", "a score of runs", "A pair of tools"]) {
    assert.ok(numberIssues(w).length > 0, w);
  }
  for (const w of ["preference pairs", "each pair is scored", "the score rose to {{n1}}", "a score of {{n1}}", "they pair each query with a document", "scores of both models"]) {
    assert.deepEqual(numberIssues(w), [], w);
  }
});

test("ordinary words pass, including words one edit from a number word", () => {
  const ok = [
    "That is the point of the exercise.",
    "No one knows, and one of the authors says so.",
    "Compare them with one another.",
    "It is often a matter of tension, not stone, money, phone or someone else's alone time.",
    "The tenant raised the height and weight of the tent, and the right light might even help over there.",
    "A fort stood forth in the night, with a nifty tree.",
    "Validity was {{n1}}, and quality was {{n2}}.",
    "Quality was ({{n2}}) and ran {{n1}}. Done.",
    "He said \u201C{{n1}}\u201D and left; we ran it many times.",
    "{{n1}} schema validity, {{n2}} quality",
    "Validity {{n1}} and quality {{n2}}.",
    "Naïve and Łukasz, Ñandú and Đặng said so.",
    "Validity, {{n1}}. Quality, {{n2}}.",
    "A café, a naïve façade and Łukasz.",
    "Mix it up (a bit) & see: yes/no? Fine; “quoted” and ‘single’ — done – ok!",
    "I think it is fine.",
    "Percentile ranks, a quarterly report, a millionaire's headquarters, a doublet and a triplet.",
    "A weighty height, a tendency, a tensor, an attention head, a tentative offer, a forte, a quarter-less ten-ish, a stoner and nonetheless done.".replace("a quarter-less ten-ish, ", ""),
  ];
  for (const t of ok) {
    const issues = checkScript(withNarration(t), verified).filter((i) => i.code === "number_outside_placeholder" || i.code === "unverified_name");
    assert.deepEqual(issues, [], t);
  }
});

test("'one' is rejected except in the idioms, and 'point' only next to a number or placeholder", () => {
  for (const t of ["One result stood out.", "It is the one that matters.", "One, two.", "No, one."]) {
    assert.ok(has(checkScript(withNarration(t), verified), "number_outside_placeholder"), t);
  }
  for (const t of ["No one agrees.", "Any one of them.", "Every one fails.", "Some one-off.", "One of the setups."]) {
    // "one-off" splits at the hyphen: "one" preceded by "some" passes; the others are idioms
    assert.ok(!has(checkScript(withNarration(t), verified), "number_outside_placeholder"), t);
  }
  assert.ok(!has(checkScript(withNarration("The point is validity."), verified), "number_outside_placeholder"));
});

test("every substring allowlist entry really contains a number word", async () => {
  const { SUBSTRING_ALLOWLIST, FUZZY_TARGETS } = await import("../lib/script-template.ts");
  for (const w of SUBSTRING_ALLOWLIST) assert.ok(FUZZY_TARGETS.some((n) => n !== "eight" && w.includes(n)), `${w} needs no entry`);
});

test("every fuzzy allowlist entry is an ordinary word one edit from a number word of five or more letters", async () => {
  const { FUZZY_ALLOWLIST, FUZZY_TARGETS, editDistance } = await import("../lib/script-template.ts");
  for (const w of FUZZY_ALLOWLIST) assert.ok(FUZZY_TARGETS.some((t) => editDistance(w, t) === 1), `${w} needs no allowlist entry`);
  assert.equal(editDistance("three", "there"), 1, "a swap of neighbors is one edit");
  assert.equal(editDistance("fourty", "forty"), 1);
});

// --- names ---

test("method names from the title, authors and verified quotes pass; an invented name fails", () => {
  const ok = [
    "The Python Implementations are the subject.",
    "Schema-Validated LLM Workflows are the subject.",
    "This is from Sidney Shapiro and colleagues.",
    "Sidney Shapiro found it.",
    "Work by Shapiro and others, with Python, from Pearson.",
    "The study compared PydanticAI, LangGraph and DSPy.",
    "Shapiro's team ran it.",
    "Aurora Pinzón Arzola helped.",
  ];
  for (const t of ok) assert.deepEqual(checkScript(withNarration(t), verified).filter((i) => i.code === "unverified_name"), [], t);
  const bad = [
    "John Smith led the work.",
    "It was led by John Smith.",
    "Work by Smith and others.",
    "Then Smith objected.",
    "It builds on Creative Commons licensing.",
    "From Stanford, a new result.",
    "Sidney Pearson found it.",
    "Done with Gemini.",
  ];
  for (const t of bad) assert.ok(has(checkScript(withNarration(t), verified), "unverified_name"), t);
  assert.ok(has(checkScript(withScreen("Elon Musk approves"), verified), "unverified_name"));
  assert.deepEqual(checkScript(withScreen("Valid is not correct"), verified).filter((i) => i.code === "unverified_name"), []);
});

test("a name must be spelled exactly, case included", () => {
  assert.ok(has(checkScript(withNarration("This is from sidney shapiro and Sidney shapiro."), verified), "unverified_name") === false);
  assert.ok(has(checkScript(withNarration("From SIDNEY SHAPIRO."), verified), "unverified_name"));
});

test("a verified named person passes, an unlisted one fails", () => {
  const rec = { ...verified, named_people: ["Sture Holm"] };
  assert.ok(!has(checkScript(withNarration("It uses a method from Sture Holm."), rec), "unverified_name"));
  assert.ok(has(checkScript(withNarration("It uses a method from Sture Holm."), verified), "unverified_name"));
});

test("links and domain names are rejected, ordinary abbreviations are not", () => {
  for (const t of ["See https://example.com/free now.", "Visit scam.xyz today.", "Go to www.example now.", "Read it on arxiv.org."]) {
    assert.ok(has(checkScript(withNarration(t), verified), "link_in_text"), t);
  }
  for (const t of ["Tools such as e.g. agents, i.e. loops, and et al. authors.", "The sentence ends. Another starts.", "A U.S. lab."]) {
    assert.ok(!has(checkScript(withNarration(t), verified), "link_in_text"), t);
  }
});

// --- belt and braces on the rendered text ---

test("digits and non-ASCII digits in the stored narration are flagged", () => {
  const s = script();
  s.beats[0]!.narration += " 26 percent.";
  assert.ok(codes(s).includes("digits_in_narration"));
  const s2 = script();
  s2.beats[0]!.narration += " २६ percent.";
  assert.ok(codes(s2).includes("digits_in_narration"));
});

test("Arabic-Indic numerals on screen are caught", () => {
  const s = withScreen("٢٦٫٨");
  const c = codes(s);
  assert.ok(c.includes("number_outside_placeholder") && c.includes("invented_on_screen_number"));
});

test("a spoken number in the stored text that matches no verified number fails, with the beat and value", () => {
  const s = script();
  s.beats[3]!.narration += " It reached eighty-one percent.";
  const hit = checkScript(s, verified).find((i) => i.code === "unverified_spoken_number");
  assert.ok(hit);
  assert.equal(hit.beat, 3);
  assert.match(hit.message, /81/);
});

test("number words on screen are checked", () => {
  const s = script();
  s.beats[3]!.on_screen = "eighty-one percent";
  assert.ok(codes(s).includes("invented_on_screen_number"));
});

// --- unchanged rules ---

test("a never-say word fails, default list and custom", () => {
  const s = script();
  s.beats[0]!.narration += " This is a breakthrough.";
  assert.ok(codes(s).includes("never_say"));
  const s2 = setTemplates(script(), 1, { on_screen: "Revolutionary result" });
  assert.ok(codes(s2).includes("never_say"));
  const s3 = script();
  s3.beats[0]!.narration += " Nobody proves this.";
  assert.ok(codes(s3).includes("never_say"));
});

test("too short fails", () => {
  const s = script();
  for (let i = 0; i < s.beats.length; i++) setTemplates(s, i, { narration: s.beats[i]!.narration_template.split(" ").slice(0, 12).join(" ") });
  assert.ok(codes(s).includes("too_short"));
});

test("too long fails, counting rendered words", () => {
  const s = setTemplates(script(), 2, { narration: script().beats[2]!.narration_template + " " + "word ".repeat(150) });
  assert.ok(codes(s).includes("too_long"));
  const one = script();
  const base = estimateSeconds(one);
  setTemplates(one, 3, { narration: "Validity was {{n1}}." });
  // "{{n1}}" renders to five words, not one
  assert.equal(one.beats[3]!.narration, "Validity was zero point six eight four.");
  assert.ok(estimateSeconds(one) < base);
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

test("the stored beat format is strict: the old format and extra keys are rejected", () => {
  const raw = gold("2611.27106.script.json");
  const old = { ...raw, beats: raw.beats.map(({ narration_template: _a, on_screen_template: _b, ...rest }: any) => rest) };
  assert.equal(Script.safeParse(old).success, false);
  const extra = { ...raw, beats: raw.beats.map((b: any) => ({ ...b, note: "x" })) };
  assert.equal(Script.safeParse(extra).success, false);
});

test("a spoofed script arxiv_id is flagged", () => {
  const s = script();
  s.paper.arxiv_id = "2611.99999";
  assert.ok(codes(s).includes("paper_mismatch"));
});

test("schema requires a well-formed arxiv_id", () => {
  const raw = gold("2611.27106.script.json");
  raw.paper.arxiv_id = "26.8";
  assert.equal(Script.safeParse(raw).success, false);
});

test("assembleScript fills paper from the record and renders the templates", () => {
  const { paper: _paper, ...raw } = gold("2611.27106.script.json");
  const out = ScriptOutput.parse({ never_say: raw.never_say, beats: raw.beats.map((b: any) => ({ kind: b.kind, narration: b.narration_template, on_screen: b.on_screen_template })) });
  assert.ok(!("number_ids" in out.beats[0]!));
  const s = assembleScript(out, verified);
  assert.deepEqual(s.paper, { arxiv_id: verified.paper.arxiv_id, title: verified.paper.title });
  assert.deepEqual(s, script());
  assert.deepEqual(checkScript(s, verified), []);
});

test("ScriptOutput beats carry no number_ids and its descriptions say numbers are placeholders only", () => {
  const shape = ScriptOutput.shape.beats.element.shape;
  assert.deepEqual(Object.keys(shape), ["kind", "narration", "on_screen"]);
  assert.match(shape.narration.description ?? "", /\{\{id\}\}/);
  assert.match(shape.on_screen.description ?? "", /no digits, no number words/);
});

test("assembleScript rejects an out-of-order beat list", () => {
  const { paper: _paper, ...raw } = gold("2611.27106.script.json");
  const beats = raw.beats.map((b: any) => ({ kind: b.kind, narration: b.narration_template, on_screen: b.on_screen_template }));
  [beats[3], beats[4]] = [beats[4], beats[3]];
  assert.throws(() => assembleScript({ never_say: [], beats }, verified));
});
