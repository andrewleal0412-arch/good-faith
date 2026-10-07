import "server-only";
import { Agent, fetch as undiciFetch } from "undici";

// The server's outgoing HTTP to Supabase and PayPal, over connections kept open between requests. Node's fetch closes
// an idle connection after 4 seconds, so a landlord who read a page for longer than that paid for a dozen new TLS
// connections on the next click: on the hosted demo's small CPU that was most of a second, and on a laptop 340 ms
// became 800 ms for one page's reads (docs/PERFORMANCE.md). This pool keeps them for a minute (or for as long as the
// server's own Keep-Alive header allows, whichever is shorter). Only connections are shared: no request or answer is
// kept, so nothing here crosses from one session to another. A page counts rows with a GET (select with a count and
// limit(1)), not supabase-js's head: true: Supabase answers a HEAD with Connection: close, so each one cost the pool a
// connection and the page's next read a new TLS handshake (eight HEAD counts in a row opened seven connections, eight
// GET counts one; the refund review's two made the property page opened after it 250 ms slower, docs/PERFORMANCE.md).
const pool = new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 10 * 60_000, connections: 24 });

/** Whether the global fetch is the one Next.js installs in its server (it marks it `__nextPatched`, for code outside
 *  Next to tell). Undici's own fetch skips the work Next adds to every call (its tracing and cache bookkeeping, which
 *  this app does not use: a few percent of a page's server time, measured), so inside the server that one is called.
 *  Anything else in that place, a check script's stand-in for PayPal or Supabase included, is always the one called,
 *  whenever it was put there, so a test never reaches the real service. */
const isNextFetch = (f: typeof fetch) => (f as typeof fetch & { __nextPatched?: boolean }).__nextPatched === true;

/** fetch over the shared keep-alive pool: the same requests and answers as the global fetch. A body that is a form, a
 *  file or a stream goes through the global fetch, told to use the pool: undici's own classes are not Node's, so its
 *  fetch might not recognize one built from them (the app's uploads send bytes, which both take as they are). */
export const keepAliveFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const body = init?.body;
  const plain = body == null || typeof body === "string" || body instanceof Uint8Array || body instanceof ArrayBuffer || body instanceof URLSearchParams;
  if (!isNextFetch(globalThis.fetch) || !plain) return globalThis.fetch(input, { ...init, dispatcher: pool } as RequestInit);
  return undiciFetch(input as never, { ...(init as object), dispatcher: pool } as never);
}) as unknown as typeof fetch;
