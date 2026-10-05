import { clientAddress } from "@/lib/access-throttle";
import { getInvoiceForWebhook, verifyWebhookSignature } from "@/lib/paypal";
import { handlePayPalWebhook } from "@/lib/paypal-webhook";
import { webhookStore } from "@/lib/paypal-webhook-store";
import { rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PayPal's webhook deliveries (docs/DEPLOY.md, section 2). Outside the access gate (src/proxy.ts): no session comes
// with them, and PayPal's signature is what authenticates each one. Nothing in a delivery is read, stored or acted on
// until PayPal itself confirms it signed it, for the webhook PAYPAL_WEBHOOK_ID names (src/lib/paypal-webhook.ts).
// Size-capped first. The rate limit counts only a delivery the app would ask PayPal about (an event with all five
// signature headers): junk is refused for free and never counts, so a flood of it can't use up the allowance PayPal's
// real deliveries need, and the limit still keeps a flood of signed-looking requests from making the app ask PayPal
// to check signatures without end.

/** PayPal's events are a few kilobytes; a dispute with its messages a few dozen. */
const MAX_BODY = 256 * 1024;
const limited = rateLimiter({ perAddress: 120, total: 600, ms: 60_000 });
let toldAddress = false;

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Too large." }, { status: 413 });
  // The webhook this deployment listens as. Unset, no event can be checked, so none is taken (PayPal keeps retrying
  // for three days, so setting it later still receives them).
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) {
    console.error("PayPal webhook refused: PAYPAL_WEBHOOK_ID is not set, so no signature can be checked");
    return Response.json({ error: "Webhooks are not configured." }, { status: 503 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Too large." }, { status: 413 });
  const answer = await handlePayPalWebhook(raw, req.headers, {
    store: webhookStore,
    verify: (body, headers) => verifyWebhookSignature(body, headers, webhookId),
    fetchInvoice: getInvoiceForWebhook,
    admit: () => {
      const over = limited(clientAddress(req.headers));
      // Once per process: which header the address came from, so the host's logs show whether the per-address count
      // sees callers (cf-connecting-ip on Render) or only the proxy in front (set GOOD_FAITH_CLIENT_IP_HEADER then).
      if (over && !toldAddress) {
        toldAddress = true;
        const from = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"].find((h) => req.headers.get(h)) ?? "none";
        console.warn(`PayPal webhook rate-limited; the client address came from ${from}`);
      }
      return !over;
    },
  });
  return Response.json(answer.body, {
    status: answer.status,
    headers: { "Cache-Control": "no-store", ...(answer.status === 429 ? { "Retry-After": "60" } : {}) },
  });
}
