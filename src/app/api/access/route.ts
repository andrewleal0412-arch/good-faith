import { NextResponse } from "next/server";
import { clientAddress, recordWrong, throttled } from "@/lib/access-throttle";
import { ACCESS_MESSAGES as M, cookieOptions, gate, issueSession, matchCode, safeNext, sameOrigin, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

// The access page's form posts here (and the demo seed, with JSON). A right code sets the signed session cookie and
// goes on to the page that was asked for; a wrong one goes back to the form with a plain message. Public: the proxy
// lets it through without a session.
export async function POST(req: Request) {
  const json = (req.headers.get("content-type") ?? "").includes("application/json");
  // A form on another site can't sign anyone in or out here.
  if (!sameOrigin(req.headers)) return Response.json({ error: M.otherSite }, { status: 403 });

  let code = "", next = "/";
  try {
    if (json) {
      const b = (await req.json()) as { code?: unknown; next?: unknown };
      code = typeof b.code === "string" ? b.code : "";
      next = safeNext(b.next);
    } else {
      const f = await req.formData();
      code = typeof f.get("code") === "string" ? String(f.get("code")) : "";
      next = safeNext(f.get("next"));
    }
  } catch {
    return Response.json({ error: M.empty }, { status: 400 });
  }

  const back = (e: string) => {
    const q = new URLSearchParams({ e });
    if (next !== "/") q.set("next", next);
    return new Response(null, { status: 303, headers: { Location: `/access?${q}`, "Cache-Control": "no-store" } });
  };

  const g = gate();
  if (g.mode === "off") return json ? Response.json({ ok: true, kind: "owner" }) : new Response(null, { status: 303, headers: { Location: next } });
  if (g.mode === "unconfigured") return json ? Response.json({ error: M.unconfigured }, { status: 503 }) : back("unconfigured");

  const address = clientAddress(req.headers);
  if (throttled(address)) return json ? Response.json({ error: M.throttled }, { status: 429 }) : back("throttled");
  const kind = code.length > 0 && code.length <= 200 ? matchCode(code, g) : null;
  if (!kind) {
    recordWrong(address);
    return json ? Response.json({ error: M.wrong }, { status: 401 }) : back("wrong");
  }

  const { value } = issueSession(kind, g.secret);
  const res = json
    ? NextResponse.json({ ok: true, kind })
    : new NextResponse(null, { status: 303, headers: { Location: next } });
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(SESSION_COOKIE, value, cookieOptions());
  return res;
}
