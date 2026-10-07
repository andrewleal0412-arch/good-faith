// The switch for the judges'-path end-to-end test (scripts/e2e-demo.py): with it on, every Claude job answers from a
// scripted stub model (src/lib/e2e-stubs.ts), Jev is off, and every PayPal call goes to a fake PayPal held in this
// process (src/lib/e2e-paypal.ts), so the test walks the whole demo without spending a Claude call or touching the
// PayPal sandbox. No imports, so src/instrumentation.ts can read it before anything else loads.
//
// It is on only when all three hold:
//   - GOOD_FAITH_E2E_STUBS is exactly "1" (an explicit test variable, never in .env.example's values or render.yaml);
//   - the process is not on Render: Render sets RENDER (and RENDER_SERVICE_ID and others) in every service's
//     environment, so the variable set there by mistake is ignored, and the server says so in its log;
//   - PAYPAL_ENVIRONMENT is not LIVE.
// The server logs a banner at start when it is on (src/instrumentation.ts) and a line for every stubbed call.

/** Variables Render sets in every service's environment. Any one of them means the process is on Render. */
export const RENDER_MARKERS = ["RENDER", "RENDER_SERVICE_ID", "RENDER_SERVICE_NAME", "RENDER_EXTERNAL_HOSTNAME", "RENDER_EXTERNAL_URL", "RENDER_INSTANCE_ID", "RENDER_GIT_COMMIT"] as const;

type Env = Record<string, string | undefined>;

export const e2eStubsRequested = (env: Env = process.env) => env.GOOD_FAITH_E2E_STUBS === "1";
export const onRender = (env: Env = process.env) => RENDER_MARKERS.some((k) => !!env[k]?.trim());

/** Whether the stubs are on: requested, not on Render, and not against live PayPal. */
export function e2eStubs(env: Env = process.env): boolean {
  return e2eStubsRequested(env) && !onRender(env) && env.PAYPAL_ENVIRONMENT !== "LIVE";
}

/** Why a request for the stubs was ignored, or null (not requested, or on). For the start-up log. */
export function e2eStubsRefused(env: Env = process.env): string | null {
  if (!e2eStubsRequested(env)) return null;
  if (onRender(env)) return "GOOD_FAITH_E2E_STUBS is set on Render and is ignored: the stubs never run on Render. Remove it from the service's Environment.";
  if (env.PAYPAL_ENVIRONMENT === "LIVE") return "GOOD_FAITH_E2E_STUBS is ignored with PAYPAL_ENVIRONMENT=LIVE.";
  return null;
}

/** One loud line per stubbed call, so a log never leaves doubt about what answered. */
export function e2eLog(what: string) {
  console.warn(`[E2E STUBS ON] ${what}`);
}
