import { z } from "zod";

export const BEAT_KINDS = ["cold_open", "setup", "method", "result", "limits", "credits"] as const;

const TEMPLATE_RULES =
  "Numbers appear only as {{id}} placeholders, where id is the id of a number in the record (for example {{n1}}); code fills in the value. " +
  "Outside placeholders write no digits, no number words (not even one, two or ten), no fractions or multipliers (half, a third, double, twice), no percentages and no counts: rephrase without them. " +
  "Write names only as they are printed in the paper: the title, the authors or a person the record names.";

/**
 * What the scriptwriter model fills via structured output. The beats are templates: the paper identity is added by
 * code (assembleScript), which also renders each placeholder and enforces the ordering rules, so this stays a plain
 * object that converts to JSON Schema.
 */
export const ScriptOutput = z.object({
  beats: z
    .array(
      z.object({
        kind: z.enum(BEAT_KINDS).describe("Beat type. Order: cold_open, setup, method (may repeat), result, limits, credits."),
        narration: z
          .string()
          .describe(`Spoken text for this beat, as a template. ${TEMPLATE_RULES} Placeholders are read aloud as words, for example "zero point six eight four".`),
        on_screen: z
          .string()
          .describe(`Short text shown on screen, as a template, in sentence case. ${TEMPLATE_RULES} Placeholders are printed as the record has them.`),
      }),
    )
    .describe(
      "5 to 6 beats in order: cold_open, setup, method (may repeat), result, limits, credits. All narration together runs about 150 to 275 words once the placeholders are filled in (60 to 110 seconds at 2.5 words per second).",
    ),
  never_say: z.array(z.string()).describe("Extra phrases to avoid, beyond the built-in list (solved, proved, breakthrough and similar)."),
});
export type ScriptOutput = z.infer<typeof ScriptOutput>;
