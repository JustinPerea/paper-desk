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

## Verifier: whole-record scan and one tokenizer (2026-11-24, after an automated security review)
- The numeral scan walks every string field of the record (`stringFields`), so a field added to the schema later is scanned by default. The skipped fields are listed in `EXEMPT_FIELDS`: ids, quote text and number values (each verified on its own), and machine fields (`paper.arxiv_id`, `version`, `url`, `license`, `read_at`, `source`, `compact.license`, `code_url`, `depth`). Piece 3's workflow must set those machine fields itself from arXiv metadata and the fetch, never from model output, because their content is not scanned.
- Paper metadata (`paper.title`, authors, affiliations, `quotes[].section_title`, `figures[].caption`, `named_people`, `compact.results[].location`) may also use numerals from the parsed page's title, authors, headings, captions and anchor ids, so "Table 7" or "S8.T7" passes there but not in prose.
- Entries of `likely_overclaims`, `named_people`, `figures` and `compact.applies_to` with an unverified numeral are dropped like claims; `compact.method` joins the single-string fields that are reported for regeneration.
- `numerals()` no longer strips leftover commas: `normalizeNumberText` already removed valid thousands separators, so "1,2" is two numbers, not 12. `containsNumber` requires every numeral of a value to be a whole numeral token of its quote and checks for a glued digit on both sides whatever the value starts or ends with, so ".5" no longer matches inside "10.5".

## Piece 2: eve scaffold and the spike (2026-11-26, branch `piece-2`)

- **eve 1.5.0, not 1.4.0.** 1.5.0 came out 2026-11-25. Its changelog says a subagent that names a model string resolves through AI Gateway even when the parent uses a direct provider, so every agent here uses `anthropic("claude-...")` instances. Pinned exactly: `eve` 1.5.0, `ai` 7.0.183, `@vercel/connect` 2.9.6, `@types/node` 24.19.4. Installed with `--ignore-scripts`; `eve build` works without install scripts. eve's own docs ship in `node_modules/eve/docs` and are the reference from here on.
- **Built on this Mac, not in a cloud session.** Node 24.22.1 is installed through nvm. The spike needs this Mac's Vercel login and the GitHub App setup in a browser.
- **Models on Justin's own Anthropic key** (card #3479): root on `claude-sonnet-5-5`. eve reports `costUsd` only from AI Gateway, so `limits.sessionUsage` counts tokens (400k new input or 60k output per window, about $3 at Gateway list prices for Opus). Each subagent session checks its own window, so a night's total can exceed one cap.
- **No default tools** (`defaultTools: false`). On Vercel, each GitHub-channel turn checks the repo out into a sandbox whose firewall adds the App's auth to outbound `git`, so a model with `bash` could push past the approval gate. The root agent has only `read_night` and `publish_night`.
- **Only Justin starts a turn.** The repo is public; the default gate lets any comment containing the bot token start a turn. `onComment` dispatches only comments by GitHub user id 72950107. No issue, PR or CI hooks.
- **`publish_night`** needs `always()` approval, and the response policy accepts only principal `github:72950107` from `github-webhook`, for both approve and deny. Before merging it checks: PR open, head `night/<date>` in this repo into `main`, opened by a Bot, head SHA equal to the one `read_night` returned, files only under `nights/<date>/`; the merge passes `sha` so GitHub refuses it if the head moved. The gate stops the model and outsiders, not a local session holding Justin's `gh` token, which can comment as him: agents never post the approval.
- **The schedule opens the issue.** `to(github, ...)` needs an existing issue, and eve doesn't export its GitHub API helper, so `agent/lib/github.ts` gets an installation token from `connectGitHubCredentials("github/paper-desk").installationToken` and calls the REST API with `fetch`. Whether that token resolves inside a schedule invocation (outside a webhook request) is the spike's first question.
- **`read_night` is a stub** for the spike: it writes a placeholder `nights/<date>/record.json` on a night branch and opens a PR, with no model call of its own. Piece 3 replaces it. Re-running the verifier inside `publish_night` comes with piece 4.
- A deployed schedule is fired on demand with `vercel schedules invoke eve.night` (the dev dispatch route exists only in `eve dev`).
