import { z } from "zod";

export const BEAT_KINDS = ["cold_open", "setup", "method", "result", "limits", "credits"] as const;

/**
 * What the scriptwriter model fills via structured output. The paper identity is added by code (assembleScript),
 * and the ordering rules are enforced there, so this stays a plain object that converts to JSON Schema.
 */
export const ScriptOutput = z.object({
  beats: z
    .array(
      z.object({
        kind: z.enum(BEAT_KINDS).describe("Beat type. Order: cold_open, setup, method (may repeat), result, limits, credits."),
        narration: z
          .string()
          .describe(
            "Spoken text for this beat. Write every number as words, never digits. Every spoken number must be one of the record's verified numbers; small counts up to ten are fine.",
          ),
        on_screen: z
          .string()
          .describe("Short text shown on screen. May show verified numbers as digits. No numbers that are not in the record."),
        number_ids: z.array(z.string()).describe("Ids of the record's verified numbers this beat uses (for example n1). Empty if none."),
      }),
    )
    .describe(
      "5 to 6 beats in order: cold_open, setup, method (may repeat), result, limits, credits. All narration together runs about 150 to 275 words (60 to 110 seconds at 2.5 words per second).",
    ),
  never_say: z.array(z.string()).describe("Extra phrases to avoid, beyond the built-in list (solved, proved, breakthrough and similar)."),
});
export type ScriptOutput = z.infer<typeof ScriptOutput>;
