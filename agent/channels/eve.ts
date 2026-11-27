import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel, type EveAuthFn } from "eve/channels/eve";

/**
 * Why this file exists: it is eve's default eve channel (`[vercelOidc(), localDev(), placeholderAuth()]`, with the
 * default audience and turn policy) plus one grant. eve refuses tool stubs for every caller unless the channel's
 * auth returns `allowToolStubs: true`, and the root-agent evals (evals/) replace read_night and publish_night
 * with stubs so no eval can reach GitHub.
 *
 * The grant goes only to callers that localDev() admits. localDev() admits nothing unless the server runs as
 * `eve dev`, `vercel dev` or the local server `eve eval` starts (EVE_DEV=1, or VERCEL_ENV=development on
 * Vercel), and it still turns away cross-site browser requests and remote peers. A production deployment has
 * neither, so there localDev() returns null, no caller gets the grant, and a request that sends `stubs` gets 403.
 * `vercelOidc()` and `placeholderAuth()` are untouched and carry no grant.
 *
 * `allowAgentInfo` keeps /eve/v1/info open to the same local callers: eve decides that by looking for an
 * unwrapped localDev() in the list, and the wrapper hides it. The grant is the same one the default gives.
 */
const authenticateLocal = localDev();
const localDevWithStubs: EveAuthFn = async (request) => {
  const caller = await authenticateLocal(request);
  return caller ? { ...caller, allowToolStubs: true, allowAgentInfo: true } : null;
};

export default eveChannel({
  auth: [vercelOidc(), localDevWithStubs, placeholderAuth()],
});
