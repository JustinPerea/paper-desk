import { connectGitHubCredentials } from "@vercel/connect/eve";

export const OWNER = "JustinPerea";
export const REPO = "paper-desk";
/** Justin's GitHub user id. The only account whose comments start a turn. */
export const JUSTIN_GITHUB_ID = 72950107;
export const JUSTIN_PRINCIPAL_ID = `github:${JUSTIN_GITHUB_ID}`;
/** The login GitHub gives this App. Night PRs must be opened by it. */
export const APP_LOGIN = "paper-desk[bot]";

/** The GitHub App created through Vercel Connect. Its installation token is minted per call. */
export const credentials = connectGitHubCredentials("github/paper-desk");

async function token(): Promise<string> {
  const t = credentials.installationToken;
  if (t === undefined) throw new Error("GitHub App credentials have no installation token");
  return typeof t === "function" ? await t() : t;
}

/** One GitHub REST call as the App. Throws on a non-2xx status with the path and body. */
export async function gh<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

export const repoPath = (rest: string) => `/repos/${OWNER}/${REPO}${rest}`;

/** Night branches are the only head a night PR may use. */
export const NIGHT_BRANCH = /^night\/(\d{4}-\d{2}-\d{2})$/;
