import { z } from "zod";

const id = z.string().min(1);

export const FullRecord = z
  .object({
    paper: z
      .object({
        title: z.string().min(1),
        authors_as_printed: z.array(z.string()),
        affiliations: z.array(z.string()),
        arxiv_id: z.string().regex(/^\d{4}\.\d{4,5}$/),
        version: z.string().regex(/^v\d+$/),
        url: z.string().url(),
        license: z.string().nullable(),
        read_at: z.string(),
        source: z.enum(["html", "pdf"]),
      })
      .strict(),
    quotes: z.array(z.object({ id: z.string().regex(/^q\d+$/), text: z.string().min(1), anchor: id, section_title: z.string() }).strict()),
    claims: z.array(
      z.object({ text: z.string().min(1), quote_ids: z.array(id), provenance: z.enum(["authors", "inference"]) }).strict(),
    ),
    numbers: z.array(
      z
        .object({
          id,
          value: z.string().min(1),
          unit: z.string(),
          comparison: z.string().nullable(),
          condition: z.string().nullable(),
          quote_id: id,
        })
        .strict(),
    ),
    limits_authors: z.array(z.object({ text: z.string().min(1), quote_id: id }).strict()),
    likely_overclaims: z.array(z.string()),
    named_people: z.array(z.string()),
    figures: z.array(z.object({ id, caption: z.string(), license_ok: z.boolean() }).strict()),
    change_for_agents: z.string().nullable(),
    /** The compact fields of docs/records-contract.md, served at depth "full". */
    compact: z
      .object({
        claim: z.string(),
        method: z.string(),
        results: z.array(z.object({ finding: z.string(), location: z.string().nullable() }).strict()),
        limits: z.string().nullable(),
        license: z.string().nullable(),
        code_url: z.string().url().nullable(),
        applies_to: z.array(z.string()),
        depth: z.literal("full"),
      })
      .strict(),
  })
  // Strict on purpose: a personal field such as why_it_matters_for_justin must be rejected, not stripped.
  .strict()
  .superRefine((r, ctx) => {
    // Malformed (as opposed to failing verification): duplicate ids and dangling references.
    const dup = (path: "quotes" | "numbers", ids: string[]) => {
      const seen = new Set<string>();
      ids.forEach((x, i) => {
        if (seen.has(x)) ctx.addIssue({ code: "custom", path: [path, i, "id"], message: `duplicate ${path} id ${x}` });
        seen.add(x);
      });
    };
    dup("quotes", r.quotes.map((q) => q.id));
    dup("numbers", r.numbers.map((n) => n.id));
    const qids = new Set(r.quotes.map((q) => q.id));
    const ref = (path: (string | number)[], id: string) => {
      if (!qids.has(id)) ctx.addIssue({ code: "custom", path, message: `unknown quote id ${id}` });
    };
    r.numbers.forEach((n, i) => ref(["numbers", i, "quote_id"], n.quote_id));
    r.limits_authors.forEach((l, i) => ref(["limits_authors", i, "quote_id"], l.quote_id));
    r.claims.forEach((c, i) => c.quote_ids.forEach((id, j) => ref(["claims", i, "quote_ids", j], id)));
  });

export type FullRecord = z.infer<typeof FullRecord>;
