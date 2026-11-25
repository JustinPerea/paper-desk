import { z } from "zod";
import type { FullRecord } from "./record.ts";
import { normalizeText, numerals } from "./verify.ts";

export const BEAT_KINDS = ["cold_open", "setup", "method", "result", "limits", "credits"] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];

export const Beat = z
  .object({
    kind: z.enum(BEAT_KINDS),
    narration: z.string().min(1),
    on_screen: z.string(),
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
  code: "paper_mismatch" | "invented_on_screen_number" | "unknown_number_id" | "digits_in_narration" | "never_say" | "too_short" | "too_long";
  beat?: number;
  message: string;
}

export function estimateSeconds(script: Script): number {
  const words = script.beats.flatMap((b) => b.narration.trim().split(/\s+/)).filter(Boolean).length;
  return words / WORDS_PER_SECOND;
}

/** `verified` must be the record after applyVerification. */
export function checkScript(script: Script, verified: FullRecord): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const byId = new Map(verified.numbers.map((n) => [n.id, n]));
  const allowed = new Set(verified.numbers.flatMap((n) => numerals(n.value)));
  const banned = [...DEFAULT_NEVER_SAY, ...script.never_say].map((p) => normalizeText(p).toLowerCase()).filter(Boolean);

  if (script.paper.arxiv_id !== verified.paper.arxiv_id) {
    issues.push({ code: "paper_mismatch", message: `script paper ${script.paper.arxiv_id} differs from verified record ${verified.paper.arxiv_id}` });
  }
  script.beats.forEach((b, i) => {
    for (const id of b.number_ids) {
      if (!byId.has(id)) issues.push({ code: "unknown_number_id", beat: i, message: `number_ids entry ${id} is not a verified number` });
    }
    // The verified record's arXiv id (never the script's) may appear on screen (credits).
    for (const t of numerals(b.on_screen.split(verified.paper.arxiv_id).join(" "))) {
      if (!allowed.has(t)) issues.push({ code: "invented_on_screen_number", beat: i, message: `on_screen shows ${t}, which matches no verified number` });
    }
    if (/\p{Nd}/u.test(b.narration)) issues.push({ code: "digits_in_narration", beat: i, message: "narration contains digits; write numbers as words" });
    for (const field of [b.narration, b.on_screen]) {
      const f = normalizeText(field).toLowerCase();
      for (const p of banned) {
        const re = new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
        if (re.test(f)) issues.push({ code: "never_say", beat: i, message: `contains banned phrase "${p}"` });
      }
    }
  });

  const secs = estimateSeconds(script);
  if (secs < DURATION_RANGE[0]) issues.push({ code: "too_short", message: `estimated ${secs.toFixed(0)} s, minimum ${DURATION_RANGE[0]}` });
  if (secs > DURATION_RANGE[1]) issues.push({ code: "too_long", message: `estimated ${secs.toFixed(0)} s, maximum ${DURATION_RANGE[1]}` });
  return issues;
}
