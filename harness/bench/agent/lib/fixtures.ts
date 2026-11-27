import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArxivHtml } from "../../../../lib/arxiv-html";
import type { PaperKey } from "./cases";
import { hostilePaper } from "./hostile";

/**
 * Fixture reads for the bench's steps. A separate module, imported only inside step bodies, because the workflow
 * bundle refuses any module-level code that reaches Node built-ins.
 */

/** eve runs from harness/bench/, so the repo root is two levels up. */
export function fromRepo(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), "../..", path), "utf8");
}

/** The saved page, parsed as production parses arXiv's; with hostile, with the injected paragraph. */
export async function parsedFixture(key: PaperKey, hostile: boolean) {
  const html = await fromRepo(`test/fixtures/${key}v1.html`);
  return parseArxivHtml(hostile ? hostilePaper(html) : html, { arxivId: key, version: "v1" });
}
