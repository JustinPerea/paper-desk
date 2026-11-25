# Implementation notes

## Piece 1: deterministic code

Parser, record schema, verifier and script check, with no model calls. Built on a branch of the Agent Research Library repo (last commit there `56c10d2`) and moved here with fresh history on 2026-11-24.

## Decisions
- `lib/sanitize.ts` is a copy of `src/sanitize.ts` from the Agent Research Library (a private repo) at `8f37865` (imports nothing).
- `FullRecord` is `.strict()` everywhere, so `why_it_matters_for_justin` is rejected, not silently stripped. Same for `compact`.
- Numbers match by token: `0.68` does not match inside `0.684`. A range such as `0.91–0.94` is matched whole in the quote.
- Dropping a quote cascades: its numbers and limits are dropped; an `authors` claim keeps its other ok quote ids and is dropped if none remain. `inference` claims always stay (with failed quote ids removed) and are counted.
- `Script` schema also requires a `result` and a `limits` beat, and forbids repeating any kind but `method` (the spec says 5 or 6 beats but not which kind a 5-beat script omits).
- `checkScript` lets the paper's own arXiv id appear on screen (credits); any other numeral must equal a numeral inside a verified number's value, so a range value allows both ends.
- Papers are fixtures only for the CC-BY 4.0 licenses; fixtures are listed in `test/fixtures/README.md`.

## Verifier hardening (second commit)
- Quotes need 6 words (paragraph, abstract) or 3 tokens (table) after normalization, else `too_short` (not ok, dropped).
- `numeral_issues`: numerals in free-text fields must equal a numeral of an ok number's value or appear in an ok quote; the verified record's arXiv id is exempt. No year carve-out: a year must come from a quote. Side effect: labels like "Table 2" or "H1" in free text are flagged unless quoted.
- `applyVerification` drops claims, limits, `compact.results` entries and numbers carrying an unverified numeral; single-string fields stay and are returned as `reported`.
- `FullRecord` superRefine: unique quote and number ids, no dangling quote references (malformed, not a verification failure).
- `checkScript` exempts the verified record's arXiv id, never the script's; a differing `script.paper.arxiv_id` is `paper_mismatch`. All `\p{Nd}` digits are folded to ASCII in `normalizeNumberText` (also `٫` as a decimal point) and narration is tested with `\p{Nd}`.

## arXiv HTML quirks
- Abstract paragraphs are `<p class="ltx_p">` inside `div.ltx_abstract`, not `ltx_para`; ids come from the parser (`abstract.p1`).
- Body paragraphs are `div.ltx_para`; in lists they nest, so only the outermost is kept (the text of nested ones is inside it). Headings inside sections like `S1.SS0.SSS0.Px1` are `ltx_paragraph` sections, so `section_title` can be a run-in heading.
- 2611.26897 leaks LaTeX preamble junk (`\setmainfont` options) as top-level paragraphs `p1`, `p2` outside any section. They are skipped (no section).
- Math alttext is raw LaTeX (`\times`), so prose like `condition×task` parses as `condition\timestask`. Numbers in math are preserved.
- Tables are `figure.ltx_table`; cells joined with ` | `. Appendices are kept; the bibliography is removed.
- `https://arxiv.org/html/2611.26966v1` returned 404 (a CC-BY candidate); replaced by 2611.26897.

## Not done
- No affiliations from the parser (the gold record has them by hand). No PDF fallback. Equation-heavy text is only as readable as the alttext.
