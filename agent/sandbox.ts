import { DefaultSandbox, defineSandbox } from "eve/sandbox";

/**
 * eve's default sandbox with one change: no automatic just-bash install. The agent runs no sandbox tools
 * (defaultTools: false), but `eve dev` and `eve eval` otherwise add just-bash and its 67 packages to package.json and
 * the lockfile with a caret range, which would then install on every Vercel build. Deployments use Vercel Sandbox.
 */
export const environment = DefaultSandbox.environment({ justBash: { autoInstall: false } });

export default defineSandbox(() => environment.open());
