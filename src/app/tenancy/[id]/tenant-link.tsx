"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { longDate, pacificDate } from "@/lib/dates";

// The private tenant link: made here, copied once, turned off here. The token is shown the one time it is made,
// since only its hash is kept; making another replaces the live one. "Email it" opens the landlord's own mail app
// with the link in a draft to the tenants on file: the app itself sends nothing.
export function TenantLinkPanel(p: {
  tenancyId: string;
  address: string;
  contacts: { name: string; email: string | null }[];
  active: { id: string; createdAt: string; lastSeenAt: string | null } | null;
}) {
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null); // the link just made, held until the page is left
  const [copied, setCopied] = useState(false);
  const [copyNote, setCopyNote] = useState(""); // shown under the field when the clipboard is unavailable
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const api = `/api/tenancies/${p.tenancyId}/tenant-link`;

  async function create() {
    if (p.active && !confirm("Make a new link? The current one stops working the moment the new one exists.")) return;
    setBusy("create");
    setError("");
    setCopied(false);
    setCopyNote("");
    const r = await fetch(api, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setError(j.error ?? "Couldn't create the link.");
    setUrl(`${window.location.origin}${j.path}`);
    router.refresh();
  }

  async function revoke() {
    if (!confirm("Turn the tenant link off? Anyone opening it sees a plain not-found page from then on.")) return;
    setBusy("revoke");
    setError("");
    const r = await fetch(api, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't turn the link off.");
    setUrl(null);
    router.refresh();
  }

  /** The clipboard API exists only on secure origins (localhost or https), so over plain http the field is selected
   *  and the older copy command tried before falling back to copying by hand. */
  async function copy() {
    if (!url) return;
    setCopyNote("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      return;
    } catch { /* fall through */ }
    field.current?.focus();
    field.current?.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    if (ok) setCopied(true);
    else setCopyNote("Couldn't copy automatically. The link is selected: copy it with Cmd+C or Ctrl+C.");
  }

  const names = p.contacts.map((c) => c.name);
  const emails = p.contacts.map((c) => c.email?.trim()).filter((e): e is string => !!e);
  const who = names.join(" and ") || "the tenants";
  // Times on the landlord's pages are Pacific, where the tenancies are; pinning it also keeps the server and browser renders identical.
  const when = (ts: string) => new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  const mailto = url && emails.length
    ? `mailto:${emails.join(",")}?subject=${encodeURIComponent(`Your security deposit at ${p.address}`)}&body=${encodeURIComponent(
      `Here is your private page for the ${p.address} deposit: ${url}\n\nIt shows the deposit you paid, the agreement you signed, the move-in photos and, later, the itemized statement. You can tell me there when you are moving out and where to mail the statement.`,
    )}`
    : null;

  return (
    <section className="mt-10">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Tenant link</h2>
      <p className="mt-1 text-[14px] text-ink-2">
        A private page for {who}: the deposit they paid, the agreement they signed, the move-in photos and, once it goes out, the itemized
        statement. From it they can tell you they are moving out and where to mail the statement. It shows none of your notes, flags or activity.
      </p>
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">{error}</p>}

      <div className="mt-4 rounded-2xl bg-surface p-5 shadow-sm">
        {url ? (
          <div>
            <p className="text-[14px] font-semibold">Copy the link now</p>
            <p className="mt-1 text-[13px] text-ink-2">
              This page can&apos;t show it again: only a fingerprint of it is stored.{" "}
              {mailto ? <>Email it to {who} from your own mail app, or send it however you usually reach them.</> : <>Send it to {who} however you usually reach them.</>}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input ref={field} readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Tenant link"
                className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-2 font-mono text-[13px] text-ink" />
              <button onClick={copy} className="shrink-0 rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90">
                {copied ? "Copied" : "Copy"}
              </button>
              {mailto && (
                <a href={mailto} className="shrink-0 rounded-xl border border-line bg-surface px-4 py-2 text-center text-[14px] font-semibold text-ink hover:bg-bg">
                  Email it
                </a>
              )}
            </div>
            {copyNote && <p className="mt-1.5 text-[12px] text-ink-3">{copyNote}</p>}
          </div>
        ) : p.active ? (
          <p className="text-[14px] text-ink-2">
            Link active since <b className="text-ink">{longDate(pacificDate(p.active.createdAt))}</b>.{" "}
            {p.active.lastSeenAt ? <>Last opened {when(p.active.lastSeenAt)}.</> : "Not opened yet."}
          </p>
        ) : (
          <p className="text-[14px] text-ink-2">No link yet. Make one and send it to {who}; you can turn it off any time.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!url && (
            <button onClick={create} disabled={busy === "create"}
              className={`rounded-xl px-4 py-2 text-[14px] font-semibold disabled:opacity-40 ${p.active ? "border border-line bg-surface text-ink hover:bg-bg" : "bg-accent text-white hover:opacity-90"}`}>
              {busy === "create" ? "Making it..." : p.active ? "Make a new link" : "Create the tenant link"}
            </button>
          )}
          {p.active && (
            <button onClick={revoke} disabled={busy === "revoke"} className="rounded-xl px-4 py-2 text-[14px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-40">
              {busy === "revoke" ? "Turning it off..." : "Turn the link off"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
