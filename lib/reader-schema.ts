import { z } from "zod";

const id = z.string().min(1);

/**
 * What the reader model returns: the judgment fields of FullRecord. No `paper` (it comes from the parsed page),
 * no quote section_title, no compact.license or compact.depth (set by code). Not strict and no superRefine:
 * this schema becomes JSON Schema for structured output. FullRecord.parse in assembleRecord does the strict checks.
 */
export const ReaderOutput = z.object({
  quotes: z
    .array(
      z.object({
        id: z.string().regex(/^q\d+$/).describe('Quote id: "q1", "q2", ... unique within the record.'),
        text: z
          .string()
          .min(1)
          .describe("Copied word for word from the paragraph, table or figure caption whose id is `anchor`. No paraphrase, no ellipsis. At least 6 words (3 cells or tokens for a table)."),
        anchor: id.describe("The id of the paragraph, table or figure the text comes from, exactly as shown in square brackets in the paper text."),
      }),
    )
    .describe("Verbatim evidence. Every claim, number and limit points at one of these."),
  claims: z
    .array(
      z.object({
        text: z.string().min(1),
        quote_ids: z.array(id).describe("Ids of quotes that support the claim."),
        provenance: z.enum(["authors", "inference"]).describe('"authors" when the paper states the claim; "inference" when you derived it. An "authors" claim needs a supporting quote.'),
      }),
    )
    .describe("What the paper claims, one finding per entry."),
  numbers: z
    .array(
      z.object({
        id: id.describe('Number id: "n1", "n2", ... unique within the record.'),
        value: z.string().min(1).describe("The number exactly as it is written in the quote, e.g. \"26.8%\" or \"0.68\". It must appear in the quote's text."),
        unit: z.string().describe('Unit or metric, e.g. "%", "accuracy", "ms". Empty string when none.'),
        comparison: z.string().nullable().describe("What it is compared with (baseline, prior work), or null."),
        condition: z.string().nullable().describe("The setting it holds in (dataset, model size), or null."),
        quote_id: id.describe("The quote that contains the value."),
      }),
    )
    .describe("Headline numbers. Do not state any numeral in other fields that is not in a number or a quote."),
  limits_authors: z
    .array(z.object({ text: z.string().min(1), quote_id: id.describe("The quote where the authors state this limit.") }))
    .describe("Limits the authors themselves state."),
  likely_overclaims: z.array(z.string()).describe("Places where the paper's claim may exceed its evidence. Your judgment; contain no numerals that are not in a quote."),
  named_people: z.array(z.string()).describe("People named in the paper's text who are not authors, spelled as printed. Empty when none."),
  figures: z
    .array(
      z.object({
        id: id.describe("A figure id from the paper text."),
        caption: z.string(),
        license_ok: z.boolean().describe("True only when the paper states the figure is under a license that allows reuse. When unsure, false."),
      }),
    )
    .describe("Figures worth showing."),
  change_for_agents: z.string().nullable().describe("What someone building agents should do differently because of this paper, or null when nothing."),
  compact: z.object({
    claim: z.string().describe("One sentence: the paper's main claim."),
    method: z.string().describe("One or two sentences on how they did it."),
    results: z
      .array(z.object({ finding: z.string(), location: z.string().nullable().describe("Table or figure id the finding comes from, or null.") }))
      .describe("Key results. Numerals here must come from a number or a quote."),
    limits: z.string().nullable().describe("The main limit in one sentence, or null."),
    code_url: z.string().url().nullable().describe("Link to the code if the paper gives one, else null."),
    applies_to: z.array(z.string()).describe("Short tags for the kinds of systems this applies to."),
  }),
});
export type ReaderOutput = z.infer<typeof ReaderOutput>;
