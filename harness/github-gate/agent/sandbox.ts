import { DefaultSandbox, defineSandbox } from "eve/sandbox";

/** Same as the production agent's sandbox file: no automatic just-bash install (see agent/sandbox.ts). */
export const environment = DefaultSandbox.environment({ justBash: { autoInstall: false } });

export default defineSandbox(() => environment.open());
