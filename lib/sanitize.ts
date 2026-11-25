// Copied from agent-research-library src/sanitize.ts at commit 8f37865c0400074488032ca7a57c888db6c16605. It imports nothing.
/**
 * Everything served by this library is third-party text summarized by a model. The
 * sanitizer does not make it trustworthy; it removes markup that has no business in a
 * structured field, caps lengths, keeps only http(s) URLs, and flags text that reads like
 * an instruction to an agent so consumers can see it.
 */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const MD_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore (all |any )?(the )?(previous|prior|above) (instructions|prompts?)\b/i,
  /\bdisregard (all |any )?(the )?(previous|prior|above)\b/i,
  /\byou are now\b/i,
  /\bnew instructions?:/i,
  /\b(system|developer) prompt\s*:/i,
  /<\s*\/?\s*(system|assistant|user)\s*>/i,
  /\bdo not (tell|inform) the user\b/i,
  /\b(run|execute) (this|the following) (command|code)\b/i,
];

export const LIMITS = {
  title: 400,
  short: 600,
  medium: 1500,
  long: 4000,
} as const;

export interface Sanitized {
  text: string;
  flags: string[];
}

export function cleanText(input: string | null | undefined, max: number = LIMITS.medium): string | null {
  if (input == null) return null;
  let s = String(input);
  s = s.replace(HTML_COMMENT, "").replace(HTML_TAG, "").replace(CONTROL, "");
  s = s.replace(WIKILINK, (_m, target: string, label?: string) => (label ?? target).trim());
  s = s.replace(MD_LINK, (_m, label: string) => label);
  s = s.replace(/\*\*/g, "").replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return s;
}

export function instructionFlags(...fields: Array<string | null | undefined>): string[] {
  for (const f of fields) {
    if (!f) continue;
    if (INSTRUCTION_PATTERNS.some((re) => re.test(f))) return ["possible_instruction_text"];
  }
  return [];
}

export function cleanUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim().replace(/[<>]/g, "");
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const ARXIV_ID = /(\d{4}\.\d{4,5})(v\d+)?/;

export function arxivIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)arxiv\.org$/.test(u.hostname)) return null;
    const m = u.pathname.match(ARXIV_ID);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export function normalizeArxivId(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = String(id).match(ARXIV_ID);
  return m ? m[1]! : null;
}

export function recordIdFor(url: string | null, arxivId: string | null, title: string): string {
  if (arxivId) return `arxiv:${arxivId}`;
  if (url) {
    const u = new URL(url);
    return `web:${u.hostname}${u.pathname.replace(/\/$/, "")}`;
  }
  return `title:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}`;
}

/** Split a focus area like "context folding / long-horizon history" into tags. */
export function tagsFromFocus(focus: string | null): string[] {
  if (!focus) return [];
  return [
    ...new Set(
      focus
        .split(/\s*[\/;,·]\s*|\s+&\s+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 1 && t.length < 60),
    ),
  ];
}

export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
