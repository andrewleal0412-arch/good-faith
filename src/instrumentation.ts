import { e2eStubs, e2eStubsRefused } from "./lib/e2e-switch";

// Runs once when the server starts (Next.js instrumentation). It only speaks up about the judges'-path test's stubs
// (src/lib/e2e-switch.ts): a banner when they are on, so a log can never be mistaken for a real run, and an error line
// when GOOD_FAITH_E2E_STUBS is set where it is ignored (Render, or live PayPal).
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const refused = e2eStubsRefused();
  if (refused) console.error(`[E2E STUBS IGNORED] ${refused}`);
  if (!e2eStubs()) return;
  const line = "=".repeat(100);
  console.warn([
    line,
    "[E2E STUBS ON] GOOD_FAITH_E2E_STUBS=1: this server is the judges'-path test's (scripts/e2e-demo.py).",
    "[E2E STUBS ON] Every Claude job answers from a scripted stub model, Jev is off, and every PayPal call goes to a",
    "[E2E STUBS ON] fake PayPal in this process that refunds only the test's own fake deposits. No Claude call, no",
    "[E2E STUBS ON] PayPal request, no money. Never run a demo for anyone on this server.",
    line,
  ].join("\n"));
}
