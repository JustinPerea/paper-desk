import { z } from "zod";
import type { FullRecord } from "./record.ts";
import { normalizeText, numerals } from "./verify.ts";
import { BEAT_KINDS } from "./script-schema.ts";
import type { ScriptOutput } from "./script-schema.ts";
import { spokenNumbers } from "./number-words.ts";
import { scaledNumerals } from "./number-render.ts";
import { RenderError, linkIssues, nameIssues, nameSources, numberIssues, renderTemplate } from "./script-template.ts";

export { BEAT_KINDS };
export type BeatKind = (typeof BEAT_KINDS)[number];

/**
 * A stored beat: the templates the scriptwriter wrote, the text rendered from them, and the record number ids the
 * templates use. checkScript re-renders the templates from the record, so `narration` and `on_screen` cannot be
 * edited independently of them.
 */
export const Beat = z
  .object({
    kind: z.enum(BEAT_KINDS),
    narration: z.string().min(1),
    on_screen: z.string(),
    narration_template: z.string().min(1),
    on_screen_template: z.string(),
    number_ids: z.array(z.string()),
  })
  .strict();

export const Script = z
  .object({
    beats: z.array(Beat).min(5).max(6),
    never_say: z.array(z.string()),
    paper: z.object({ arxiv_id: z.string().regex(/^\d{4}\.\d{4,5}$/), title: z.string() }).strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    let prev = -1;
    const seen = new Set<string>();
    s.beats.forEach((b, i) => {
      const idx = BEAT_KINDS.indexOf(b.kind);
      if (idx < prev) ctx.addIssue({ code: "custom", path: ["beats", i, "kind"], message: `beat ${b.kind} is out of order` });
      if (b.kind !== "method" && seen.has(b.kind)) ctx.addIssue({ code: "custom", path: ["beats", i, "kind"], message: `${b.kind} may not repeat` });
      seen.add(b.kind);
      prev = Math.max(prev, idx);
    });
    for (const need of ["result", "limits"] as const) {
      if (!seen.has(need)) ctx.addIssue({ code: "custom", path: ["beats"], message: `missing ${need} beat` });
    }
  });
export type Script = z.infer<typeof Script>;

export const DEFAULT_NEVER_SAY = ["solved", "proved", "proves", "breakthrough", "game-changer"];
export const WORDS_PER_SECOND = 2.5;
export const DURATION_RANGE = [60, 110] as const;

export interface ScriptIssue {
  code:
    | "paper_mismatch"
    | "render_mismatch"
    | "number_outside_placeholder"
    | "unverified_name"
    | "link_in_text"
    | "invented_on_screen_number"
    | "unknown_number_id"
    | "number_not_speakable"
    | "digits_in_narration"
    | "unverified_spoken_number"
    | "never_say"
    | "too_short"
    | "too_long";
  beat?: number;
  message: string;
}

export function estimateSeconds(script: Script): number {
  const words = script.beats.flatMap((b) => b.narration.trim().split(/\s+/)).filter(Boolean).length;
  return words / WORDS_PER_SECOND;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * `verified` must be the record after applyVerification. Every check re-derives from the record: the stored
 * narration and on_screen are re-rendered from their templates, so a stored script that was edited after assembly
 * fails with render_mismatch.
 */
export function checkScript(script: Script, verified: FullRecord): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const byId = new Map(verified.numbers.map((n) => [n.id, n]));
  // A verified value's numerals, plus its scaled form ("1.2B" is said "one point two billion": 1200000000).
  const allowed = new Set(verified.numbers.flatMap((n) => [...numerals(n.value), ...scaledNumerals(n.value)]));
  const banned = [...DEFAULT_NEVER_SAY, ...script.never_say].map((p) => normalizeText(p).toLowerCase()).filter(Boolean);
  const sources = nameSources(verified);

  if (script.paper.arxiv_id !== verified.paper.arxiv_id) {
    issues.push({ code: "paper_mismatch", message: `script paper ${script.paper.arxiv_id} differs from verified record ${verified.paper.arxiv_id}` });
  }
  if (script.paper.title !== verified.paper.title) {
    issues.push({ code: "paper_mismatch", message: "script paper title differs from the verified record" });
  }
  script.beats.forEach((b, i) => {
    const add = (code: ScriptIssue["code"], message: string) => issues.push({ code, beat: i, message });
    for (const id of b.number_ids) {
      if (!byId.has(id)) add("unknown_number_id", `number_ids entry ${id} is not a verified number`);
    }

    // 1. The stored text is exactly what the templates render to from the verified record.
    try {
      const n = renderTemplate(b.narration_template, byId, "spoken");
      const s = renderTemplate(b.on_screen_template, byId, "screen");
      if (n.text !== b.narration) add("render_mismatch", "narration is not what narration_template renders to");
      if (s.text !== b.on_screen) add("render_mismatch", "on_screen is not what on_screen_template renders to");
      const ids = [...new Set([...n.ids, ...s.ids])];
      if (!sameList(ids, b.number_ids)) add("render_mismatch", `number_ids ${JSON.stringify(b.number_ids)} differ from the placeholders used ${JSON.stringify(ids)}`);
    } catch (e) {
      if (!(e instanceof RenderError)) throw e;
      add(e.code, e.message);
    }

    // 2 to 4. Nothing but placeholders may state a number, no name the record doesn't back, no link.
    for (const [label, tpl] of [["narration_template", b.narration_template], ["on_screen_template", b.on_screen_template]] as const) {
      for (const m of numberIssues(tpl)) add("number_outside_placeholder", `${label}: ${m}`);
      for (const m of nameIssues(tpl, sources)) add("unverified_name", `${label}: ${m}`);
      for (const m of linkIssues(tpl)) add("link_in_text", `${label}: ${m}`);
    }

    // Belt and braces on the stored, rendered text: independent of the template rules above.
    if (/\p{N}/u.test(b.narration)) add("digits_in_narration", "narration contains digits; numbers are rendered as words");
    // "1" is allowed because the template rules let the idioms "no one" and "one of" through.
    for (const v of new Set(spokenNumbers(b.narration))) {
      if (allowed.has(v) || v === "1") continue;
      add("unverified_spoken_number", `narration says ${v}, which matches no verified number`);
    }
    for (const v of new Set(spokenNumbers(b.on_screen))) {
      if (allowed.has(v) || v === "1") continue;
      add("invented_on_screen_number", `on_screen shows ${v}, which matches no verified number`);
    }
    for (const field of [b.narration, b.on_screen]) {
      const f = normalizeText(field).toLowerCase();
      for (const p of banned) {
        const re = new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
        if (re.test(f)) add("never_say", `contains banned phrase "${p}"`);
      }
    }
  });

  const secs = estimateSeconds(script);
  // In words, because that is what the scriptwriter can count; numbers count as their spoken form ("zero point six
  // eight four" is five words), not as one placeholder.
  const words = Math.round(secs * WORDS_PER_SECOND);
  const [minWords, maxWords] = DURATION_RANGE.map((x) => x * WORDS_PER_SECOND) as [number, number];
  if (secs < DURATION_RANGE[0])
    issues.push({ code: "too_short", message: `narration is ${words} words with numbers spoken in full (about ${secs.toFixed(0)} s); the minimum is ${minWords} words (${DURATION_RANGE[0]} s), so add at least ${minWords - words}` });
  if (secs > DURATION_RANGE[1])
    issues.push({ code: "too_long", message: `narration is ${words} words with numbers spoken in full (about ${secs.toFixed(0)} s); the maximum is ${maxWords} words (${DURATION_RANGE[1]} s), so cut at least ${words - maxWords}` });
  return issues;
}

/**
 * Code fills the paper identity from the record and renders each template; Script.parse then runs the strict and
 * ordering checks. Throws on a placeholder that names no number of the record, on a number with no exact spoken
 * form, and on a malformed script. `record` must be the record after applyVerification.
 */
export function assembleScript(out: ScriptOutput, record: FullRecord): Script {
  const byId = new Map(record.numbers.map((n) => [n.id, n]));
  const beats = out.beats.map((b) => {
    const n = renderTemplate(b.narration, byId, "spoken");
    const s = renderTemplate(b.on_screen, byId, "screen");
    return {
      kind: b.kind,
      narration: n.text,
      on_screen: s.text,
      narration_template: b.narration,
      on_screen_template: b.on_screen,
      number_ids: [...new Set([...n.ids, ...s.ids])],
    };
  });
  return Script.parse({ beats, never_say: out.never_say, paper: { arxiv_id: record.paper.arxiv_id, title: record.paper.title } });
}
