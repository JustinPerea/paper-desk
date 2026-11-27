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
- **`publish_night` merges without a human step** (Justin, 2026-11-26: he doesn't want to approve each night). The first version used `always()` approval answered only by his GitHub account; run 2 of the spike reached that prompt, then the gate was removed. It merges only when its checks pass: PR open, head `night/<date>` in this repo into `main`, opened by `paper-desk[bot]`, head SHA equal to the one `read_night` returned, files only under `nights/<date>/`; the merge passes `sha` so GitHub refuses it if the head moved. With no person in the loop, the verifier re-run inside `publish_night` (piece 4) is the only content check, so it has to land before the first real night. Posts to X and YouTube still go through Justin.
- **The schedule opens the issue.** `to(github, ...)` needs an existing issue, and eve doesn't export its GitHub API helper, so `agent/lib/github.ts` gets an installation token from `connectGitHubCredentials("github/paper-desk").installationToken` and calls the REST API with `fetch`. Whether that token resolves inside a schedule invocation (outside a webhook request) is the spike's first question.
- **`read_night` is a stub** for the spike: it writes a placeholder `nights/<date>/record.json` on a night branch and opens a PR, with no model call of its own. Piece 3 replaces it. Re-running the verifier inside `publish_night` comes with piece 4.
- A deployed schedule is fired on demand with `vercel schedules invoke eve.night` (the dev dispatch route exists only in `eve dev`).
- **GitHub App setup through Vercel Connect.** `eve add channel/github` opens the Connect link in the default browser by itself (setting `BROWSER` doesn't stop it), and the link's `request_code` works once. A copy of the link opened anywhere else shows `Request code is already in use`; finish the setup in the tab eve opened. The run created connector `github/paper-desk`, attached it to production and registered `/eve/v1/github` as the trigger destination. It then refused to overwrite `agent/channels/github.ts` (no `--force`), which keeps this repo's `onComment` gate.
- **App permissions.** Connect's managed App asks for read and write on actions, checks, code, commit statuses, deployments, environments, issues, packages, pages, pull requests and workflows. The agent needs contents, issues and pull requests (read and write) plus metadata. Justin trims the rest in the App's GitHub settings, because GitHub has no API for an App's permissions. An App token can't be fetched from the CLI (`vercel connect token --subject app` returns "Token subject is not accessible to this requester"), so the deployed spike is where the installation's access gets checked.

## eve only (2026-11-26, Justin)

Every part of the run uses eve; the entry depends on nothing outside it.
- **Candidates from arXiv, not Grok's digest.** A tool fetches arXiv's RSS feed for the chosen categories in one request (`rss.arxiv.org/rss/cs.AI+cs.CL+...`, updated daily at midnight ET; announcements Sunday to Thursday at 20:00 ET, none on arXiv holidays such as 11-26) and keeps new submissions only. A Sonnet picker subagent chooses from titles and abstracts, replacing Grok's action signal and tags.
- **Video renders in eve, not in the Social agent.** A render step in a Vercel Sandbox whose build-time `prepare` installs Chromium and ffmpeg turns `script.json` into an MP4 that goes in the PR. It needs a render spike before it's sized. The record's field set came from Social's answer about what a video needs; it stays as the script's input.
- **Outside agents query through eve's MCP channel**, not the Agent Research Library server. With `tools: true, agent: false` the channel serves tools directly, with no model run, so a read-only `get_night` costs nothing per call. The channel publishes every tool that has `execute`, so `publish_night` has to refuse callers other than the night's own session, and `read_night` should be a workflow tool (eve doesn't publish those).

## MCP channel (2026-11-26)

- `agent/channels/mcp.ts`: `mcpChannel({ auth: none(), agent: false, tools: true })` at `/eve/v1/mcp`. It serves tools for direct calls with no model run, and no `agent_*` tools, so anonymous callers can't spend the model key.
- eve publishes every tool with `execute`, with no per-tool opt-out. `read_night` and `publish_night` now check the caller first (`agent/lib/caller.ts`): eve's schedule identity (`isScheduleAuth`, principal `eve:app`) or Justin's `github:72950107` from `github-webhook`. Tested live: anonymous MCP calls to both are refused before any GitHub call ("runs only in the nightly session or for Justin" in the logs), and a schedule run still opened and merged its PR (#9).
- `get_night` reads `nights/<date>/record.json` and `script.json` from `raw.githubusercontent.com` without the App's token, so public calls cost no Connect token requests.
- **Vercel deploys `main` to production on every push** (the project is Git-connected). A CLI deploy from a branch is replaced by the next merge to `main`, which happened during this test: the nightly merge of #9 redeployed `main` without the channel. Deploy only from `main`. `vercel.json` turns off preview builds for `night/*` branches, which carry only data.

## Piece 3 library (2026-11-26)

Built `lib/arxiv-feed.ts` (`parseArxivRss`, `selectNew`, `validatePick`) and `lib/reader.ts` (`ReaderOutput`, `paperForReader`, `assembleRecord`, `repairMessage`, `licenseFromAbsHtml`), with tests and two fixtures (`test/fixtures/rss-sample.xml`, `test/fixtures/abs-2611.27106.html`).
- **Feed format.** The live cs.AI+cs.CL feed held about 500 items (1 MB) with all four announce types (new, cross, replace, replace-cross), so the sample is six unedited items. `<category>` repeats per item; `<arxiv:announce_type>` is a real element (cheerio xmlMode needs the selector `arxiv\:announce_type`). The description is "arXiv:<id>v<n> Announce Type: <type> \nAbstract: <text>", and the version is `v2` or higher on replacements. Abstracts contain raw LaTeX (`$P_\theta$`), kept as is.
- **Abs page.** The license is `<div class="abs-license"><a href="http://creativecommons.org/licenses/by/4.0/" class="has_license">`, an http URL; `licenseFromAbsHtml` upgrades it to https. Papers with no license link have no `has_license` anchor, so the function returns null whenever the block or href is missing.
- **ReaderOutput** omits `quotes[].section_title` as well as the fields the brief named; `assembleRecord` fills it from the parsed page (abstract blocks "Abstract", body paragraphs their section title, tables and figures ""). It spreads the model output into `FullRecord.parse`, so an unknown field (such as `why_it_matters_for_justin`) is rejected by the strict schema rather than silently dropped. `ReaderOutput.parse` itself strips unknown keys, so callers should pass the model's raw object to `assembleRecord` only after `ReaderOutput.parse` if they want stripping, or the raw object if they want rejection.

## Piece 3 agent side (2026-11-26)

- `read_night` is now a workflow tool (`defineWorkflowTool`, so the MCP channel doesn't publish it): candidates from arXiv's RSS feed → the `picker` subagent ranks up to five → the first with arXiv HTML → the `reader` subagent → the verifier, with one repair round sent to the same reader session → `applyVerification` → a PR with `record.json` and `verification.json` (dropped items and counts). The root model gets only code-built fields: PR number, head commit, `verified`, `ready_to_publish` and a summary made of counts.
- `picker` (Sonnet 5.5) and `reader` (Opus 5.5) are declared subagents with `tool: false`, `defaultTools: false`, their own `anthropic()` models and their own token limits. `eve info` and the compiled manifest show all three models with `routing: external, provider: anthropic`, so nothing goes through AI Gateway. The root's tools are only `get_night`, `publish_night` and `read_night`.
- The reader returns judgment fields only (`lib/reader-schema.ts`); code fills `paper.*` from the parsed page and the license from the abs page, then `FullRecord.parse` runs the strict checks. Checks always re-fetch and re-parse the page rather than trusting text that passed through the workflow.
- **Workflow bundling.** The workflow body can't import anything that reaches a Node built-in (cheerio, `@vercel/connect`, `eve/schedules`). eve's transform drops a module's imports only when they're used solely inside `"use step"` bodies, so the code is in three layers: `agent/tools/read_night.ts` (body; imports only zod, `lib/reader-schema.ts` and types), `agent/lib/night-steps.ts` (only `"use step"` functions) and `agent/lib/night-io.ts` (plain helpers that only steps call). A helper function defined next to the steps keeps its imports in the bundle and fails the build. The caller check runs as a step for the same reason.
- `ready_to_publish` is false until piece 4 (script, and the verifier re-run in `publish_night`), so the PR stays open and the agent says so.

## Security review of piece 3 (2026-11-26) and fixes

An Opus review of PR #11 found no path to the token, to branch or path targets, or to publishing. It found six medium and low issues, fixed here:
1. The PR body carried the picker's prose, written from attacker-controlled abstracts, so `@user` and `owner/repo#n` could ping people from `paper-desk[bot]`. The PR body is now code-built only; the picker's reasons go to `verification.json`, where nothing renders mentions.
2. The reader's free text went into `record.json` unsanitized, `compact.code_url` accepted any scheme and wasn't checked, and `figures[].license_ok` kept the model's value. `assembleRecord` now cleans every prose field (markup, links, length), keeps `code_url` only when it's https and printed in the paper, and forces `license_ok` to false.
3. Assembly errors returned zod messages, which can echo the reader's strings, to the root model and the public issue. They now return issue codes and paths only (`errorShape`). Still open: when Justin comments on a night PR, eve's GitHub channel gives the root the PR's patch, which includes the record's prose. Only his comments start turns, so this needs his action.
4. Reruns could spend the model key without bound. `read_night` now checks first: a night already on `main` is refused, and a night with an open PR is refused unless Justin names a paper.
5. A rerun reused the branch and left earlier files and the old PR title. Files from an earlier run are deleted, the title and body are refreshed, and `publish_night` accepts only `record.json`, `verification.json`, `script.json` and `video.mp4` under `nights/<date>/`, with `record.json` required.
6. `head_sha` came from a read of the PR right after writing, which can lag. It now comes from the last write's commit.
