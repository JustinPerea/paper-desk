# paper-desk

An agent that reads one new arXiv paper each night and writes two things from it: a record of what the paper claims, with exact quotes and numbers tied to the paragraph they came from, and a script for a 60 to 110 second video about the paper. A deterministic verifier checks every quote and number against the paper's own HTML before anything is published; a night merges only if those checks pass.

This is an entry for the [eve Builder Challenge](https://eve.dev/challenge). The name is a working name.

## Status

The deterministic part is built: the arXiv HTML parser, the record schema, the quote and number verifier, and the script check. No model is called yet. The eve agent (nightly schedule, reader, scriptwriter and publish) comes next.

## Files

- `lib/arxiv-html.ts` parses an arXiv HTML page (LaTeXML) into the abstract, sections, paragraphs, tables and figure captions, each with the id arXiv gives it (`S3.p2`, `S4.T1`). Those ids are the anchors quotes point to.
- `lib/record.ts` is the record schema. Every quote has an anchor; every number names its unit, what it is compared with, under what condition, and the quote it comes from; every claim says whether the authors made it or it is an inference.
- `lib/verify.ts` checks a record against the parsed paper. A quote must appear at its anchor; a number must appear in its quote; any numeral in free text must come from a verified number or quote. Whatever fails is dropped and listed.
- `lib/script.ts` is the video script schema and its check: five or six beats written as templates. Numbers appear only as `{{id}}` placeholders that name a verified record number; code renders them as words for narration and as printed on screen, and the check rejects any other number, number word, name or link.
- `lib/sanitize.ts` strips markup, caps lengths, keeps only http(s) URLs, and flags text that reads like an instruction to an agent. It does not make paper text trustworthy; it makes suspect text visible.

## Run

Node 22 or later for this code (eve itself will need Node 24).

```bash
npm ci --ignore-scripts
npm test
npm run typecheck
```

The tests use three CC BY 4.0 papers kept in `test/fixtures/`, with their authors and licenses listed in `test/fixtures/README.md`.

## License

Apache-2.0. The fixture papers keep their own CC BY 4.0 licenses.
