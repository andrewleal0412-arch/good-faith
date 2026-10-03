import { NextResponse } from "next/server";
import { ACCESS_MESSAGES as M, cookieOptions, sameOrigin, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

// Sign out from the account menu: the session cookie is cleared and the access page opens. Public, like the form.
export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return Response.json({ error: M.otherSite }, { status: 403 });
  const res = new NextResponse(null, { status: 303, headers: { Location: "/access", "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
}
