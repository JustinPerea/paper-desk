import { generateKeyPairSync } from "node:crypto";
import { githubChannel } from "eve/channels/github";
import { justinOnlyComments } from "../../../../agent/lib/comment-gate";
import { record, TEST_WEBHOOK_SECRET } from "../lib/record";

/**
 * The production GitHub channel's gate behind self-managed test credentials. Production verifies webhooks with
 * Vercel Connect; this app signs them with an HMAC secret so an eval can post them. Everything after verification
 * (parsing, eve's bot filter, the onComment gate, dispatch) is the same eve code and the same gate function.
 */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/**
 * Every GitHub REST call the channel makes (installation token, reply comment) lands here instead of
 * api.github.com, so the fake App key never leaves the process. The host is .invalid as a second guard.
 */
async function fakeGitHub(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === "string" ? init.body : "";
  record({ kind: "api", method, path: url.pathname, authorized: headers.get("authorization")?.startsWith("Bearer ") === true, body });
  const json = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  if (method === "POST" && /\/app\/installations\/\d+\/access_tokens$/.test(url.pathname))
    return json(201, { token: "ghs_gate_harness_fake", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  if (method === "POST" && /\/issues\/\d+\/comments$/.test(url.pathname))
    return json(201, { id: Date.now(), body: JSON.parse(body || "{}").body, html_url: `https://example.invalid${url.pathname}` });
  if (method === "POST" && /\/reactions$/.test(url.pathname)) return json(201, { id: 1, content: "eyes" });
  return json(404, { message: "not stubbed" });
}

export default githubChannel({
  botName: "paper-desk",
  credentials: { appId: "1", privateKey, webhookSecret: TEST_WEBHOOK_SECRET },
  api: { apiBaseUrl: "https://api.github.invalid", fetch: fakeGitHub as typeof fetch },
  onComment: (ctx, comment) => {
    const result = justinOnlyComments(ctx, comment);
    record({
      kind: "gate",
      deliveryId: ctx.delivery.id,
      issueNumber: ctx.conversation.issueNumber,
      pullRequestNumber: ctx.conversation.pullRequestNumber,
      authorId: comment.author?.id ?? null,
      dispatched: result !== null,
    });
    return result;
  },
  events: {
    // Replaces eve's built-in handler (eyes reaction, then a git checkout in the sandbox). The checkout runs git
    // against github.com outside api.fetch and would need a sandbox package this app doesn't install, so the
    // harness records the turn start instead.
    "turn.started": async (_event, ctx) => {
      record({ kind: "turn.started", issueNumber: ctx.channel.state.issueNumber, pullRequestNumber: ctx.channel.state.pullRequestNumber });
    },
  },
});
