import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_MESSAGES as M, gate, readSession, sameOrigin, SESSION_COOKIE } from "@/lib/session";
import { PATH_HEADER } from "@/lib/page-path";
import { REQUEST_LIMIT } from "@/lib/uploads";

// The demo access gate (Next.js 16 Proxy, Node.js runtime). Every page and API route needs the signed session cookie
// that the access page sets, except the access page and its form, the tenants' own pages (/t/<token> and the
// /api/t/<token> routes they use, which their token already guards), the health check, and PayPal's webhook (which
// PayPal's signature guards). Pages without a session
// go to /access?next=..., API calls get a 401. With no access code set the gate is off outside production (local dev
// is the owner) and closed in production, where every gated page says the demo is not configured. The route handlers
// read the session again for the daily limits (src/lib/limits.ts), so a request that slipped past this file still has
// no session there.

// The PayPal webhook has no session: PayPal's signature, checked with PayPal on every delivery, authenticates it
// (src/app/api/paypal/webhook/route.ts).
const PUBLIC_EXACT = new Set(["/access", "/api/access", "/api/access/sign-out", "/api/health", "/api/paypal/webhook"]);
const isPublic = (p: string) => PUBLIC_EXACT.has(p) || p.startsWith("/t/") || p.startsWith("/api/t/");

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const api = pathname.startsWith("/api/");
  // On to the app; a page is told its own address (PATH_HEADER), whatever the browser sent in that header.
  const onward = () => {
    if (api) return NextResponse.next();
    const headers = new Headers(req.headers);
    headers.set(PATH_HEADER, pathname);
    return NextResponse.next({ request: { headers } });
  };

  if (api && req.method !== "GET" && req.method !== "HEAD") {
    // A write sent by a page on another site is refused, whatever cookie the browser attaches (SameSite=Lax already
    // keeps the session off a cross-site POST; this also covers sibling subdomains of a shared host).
    if (!sameOrigin(req.headers)) return Response.json({ error: M.crossSite }, { status: 403 });
    // A body the upload routes would refuse anyway gets the plain 413 here. Next has already received it by now (in
    // memory, up to proxyClientMaxBodySize in next.config.ts), so this spares the route, not the upload; a body sent
    // without a Content-Length is cut at that size and the route refuses it as unreadable.
    if (Number(req.headers.get("content-length") ?? 0) > REQUEST_LIMIT) {
      return Response.json({ error: "That upload was too large for the server. Try fewer photos at a time." }, { status: 413 });
    }
  }

  if (isPublic(pathname)) return NextResponse.next();
  const g = gate();
  if (g.mode === "off") return onward();
  if (g.mode === "unconfigured") {
    if (api) return Response.json({ error: M.unconfigured }, { status: 503 });
    // The access page, at the address that was asked for, says the demo is not configured.
    return NextResponse.rewrite(new URL("/access", req.url));
  }
  if (readSession(req.cookies.get(SESSION_COOKIE)?.value, g.secret)) return onward();

  if (api) return Response.json({ error: M.signedOut }, { status: 401 });
  const to = new URL("/access", req.url);
  const next = `${pathname}${search}`;
  if (next !== "/") to.searchParams.set("next", next);
  return NextResponse.redirect(to);
}

export const config = {
  // Everything but Next's own build files, its dev overlay and the favicon: pages, API routes, RSC requests and
  // server functions.
  matcher: ["/((?!_next/|__nextjs|favicon\\.ico$).*)"],
};
