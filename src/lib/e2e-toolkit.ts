import "server-only";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/mcp";
import { runTool } from "./e2e-paypal";

// The Agent Toolkit's MCP server for the judges'-path test (src/lib/e2e-switch.ts, never on Render): PayPal's own
// server class, so the close-out agent and the settlement see the same tools, schemas and answers' shape, with its
// PayPal API object (the part that sends requests) replaced by the fake PayPal (src/lib/e2e-paypal.ts). Kept apart
// from the fake so the pages that read PayPal through src/lib/paypal.ts don't load the toolkit.

type ToolkitConfiguration = ConstructorParameters<typeof PayPalAgentToolkit>[0]["configuration"];

/** PayPal's own Agent Toolkit MCP server with its PayPal API object replaced by the fake: the same tools, schemas and
 *  answers' shape, and no request ever leaves the process. Throws if the toolkit's internals changed so the swap can't
 *  be made, rather than serve the real API. */
export function fakeToolkit(configuration: ToolkitConfiguration, requestId?: string): PayPalAgentToolkit {
  const server = new PayPalAgentToolkit({ accessToken: "e2e-stub-token-not-valid-at-paypal", configuration: { ...configuration, context: { ...configuration.context, sandbox: true } } });
  const inner = server as unknown as { _paypal?: { run?: unknown } };
  if (!Object.prototype.hasOwnProperty.call(inner, "_paypal") || typeof inner._paypal?.run !== "function") {
    throw new Error("The e2e fake PayPal couldn't replace the Agent Toolkit's PayPal API (its internals changed): refusing to run.");
  }
  inner._paypal = { run: (method: string, arg: Record<string, unknown>) => runTool(method, arg ?? {}, requestId ?? null) };
  return server;
}
