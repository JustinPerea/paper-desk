import { isScheduleAuth } from "eve/schedules";
import { JUSTIN_PRINCIPAL_ID } from "./github";

type Auth = { principalId?: string; authenticator?: string } | null | undefined;

/**
 * Who may run the tools that write to GitHub or spend the model key: the nightly schedule (eve's app identity)
 * or Justin through the GitHub channel. The MCP channel publishes every tool with `execute` to anonymous callers,
 * so these tools must check the caller themselves.
 */
export function isNightRunner(auth: Auth): boolean {
  if (isScheduleAuth(auth as Parameters<typeof isScheduleAuth>[0])) return true;
  return auth?.principalId === JUSTIN_PRINCIPAL_ID && auth?.authenticator === "github-webhook";
}

export function requireNightRunner(auth: Auth, tool: string): void {
  if (!isNightRunner(auth)) throw new Error(`${tool} runs only in the nightly session or for Justin`);
}
