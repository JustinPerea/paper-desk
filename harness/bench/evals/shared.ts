import type { EveEvalContext } from "eve/evals";

/**
 * Sends the mock root a request for one bench tool and returns that tool's output. The output comes from the recorded
 * tool call, not the root's reply, so a mock that garbles its reply can't change a grade.
 */
export async function runTool<T>(t: EveEvalContext, tool: string, input: unknown): Promise<T> {
  const turn = await t.send(JSON.stringify({ tool, input }));
  t.succeeded();
  t.noFailedCalls();
  const output = turn.requireToolCall(tool).output as T;
  t.log(`${tool} output: ${JSON.stringify(output)}`);
  return output;
}
