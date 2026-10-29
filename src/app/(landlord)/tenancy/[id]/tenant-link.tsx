"use client";

import { useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { useRefresh } from "@/components/refresh";
import { Card, CardHead, Notice, StatusChip, inputClass } from "@/components/ui";
import { copyText } from "@/lib/clipboard";
import { TENANT_VIEW_TIP } from "@/lib/copy";
import { dateIn, PACIFIC, shortDate } from "@/lib/dates";

// The private tenant link: made here, copied once, turned off here. The token is shown the one time it is made,
// since only its hash is kept; making another replaces the live one. "Email it" opens the landlord's own mail app
// with the link in a draft to the tenants on file: the app itself sends nothing.
export function TenantLinkPanel(p: {
  tenancyId: string;
  address: string;
  contacts: { name: string; email: string | null }[];
  active: { id: string; createdAt: string; lastSeenAt: string | null } | null;
  quiet?: boolean; // the record header holds the view's primary button, so this panel's buttons are secondary
  demoHref?: string | null; // a demo copy's tenants' page, which its own pages may open again (one person plays both sides)
  zone?: string; // the property's time zone (its state pack's), which its times are shown in
}) {
  const refresh = useRefresh();
  const [confirm, dialog] = useConfirm();
  const field = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null); // the link just made, held until the page is left
  const [copied, setCopied] = useState(false);
  const [copyNote, setCopyNote] = useState(""); // shown under the field when the clipboard is unavailable
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const api = `/api/tenancies/${p.tenancyId}/tenant-link`;

  async function create() {
    if (p.active && !(await confirm({ title: "Make a new link?", body: "The current link stops working the moment the new one exists.", action: "Make a new link" }))) return;
    setBusy("create");
    setError("");
    setCopied(false);
    setCopyNote("");
    const r = await fetch(api, { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setBusy(null); return setError(j.error ?? "Couldn't create the link."); }
    refresh(() => { setBusy(null); setUrl(`${window.location.origin}${j.path}`); });
  }

  async function revoke() {
    if (!(await confirm({ title: "Turn the link off?", body: "Anyone opening it sees a plain not-found page from then on.", action: "Turn off" }))) return;
    setBusy("revoke");
    setError("");
    const r = await fetch(api, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) { setBusy(null); return setError((r ? (await r.json().catch(() => ({}))).error : null) ?? "Couldn't turn the link off."); }
    refresh(() => { setBusy(null); setUrl(null); });
  }

  /** The clipboard API exists only on secure origins (localhost or https), so over plain http the field is selected
   *  and the older copy command tried before falling back to copying by hand (src/lib/clipboard.ts). */
  async function copy() {
    if (!url) return;
    setCopyNote("");
    if (await copyText(url, field.current)) setCopied(true);
    else setCopyNote("Couldn't copy automatically. The link is selected: copy it with Cmd+C or Ctrl+C.");
  }

  const names = p.contacts.map((c) => c.name);
  const emails = p.contacts.map((c) => c.email?.trim()).filter((e): e is string => !!e);
  const who = names.join(" and ") || "the tenants";
  // Times are on the property's clock (its state's zone; its short name outside Pacific time); pinning the zone also
  // keeps the server and browser renders identical.
  const zone = p.zone ?? PACIFIC;
  const when = (ts: string) => new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone, ...(zone === PACIFIC ? {} : { timeZoneName: "short" as const }) });
  const mailto = url && emails.length
    ? `mailto:${emails.join(",")}?subject=${encodeURIComponent(`Your security deposit at ${p.address}`)}&body=${encodeURIComponent(
      `Here is your private page for the ${p.address} deposit: ${url}\n\nIt shows the deposit you paid, the agreement you signed, the move-in photos and, later, the itemized statement. You can tell me there when you are moving out and where to mail the statement.`,
    )}`
    : null;

  return (
    <Card>
      <CardHead title="Tenant link"
        right={<InfoTip align="end" title={`A private page for ${who}`}>
          The deposit they paid, the agreement they signed, the move-in photos and, once it goes out, the itemized statement. From
          it they can say they are moving out and where to mail the statement. It shows none of your notes, flags or activity.
        </InfoTip>} />
      <div className="px-5 py-4">
        {error && <Notice className="mb-3">{error}</Notice>}
        {url ? (
          <div>
            <p className="text-sm font-medium">Copy the link now</p>
            <p className="mt-0.5 text-xs text-ink-3">It is shown once: only a fingerprint of it is stored.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input ref={field} readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Tenant link"
                className={`${inputClass} min-w-0 flex-1 text-sm`} />
              <Button variant={p.quiet ? "secondary" : "primary"} onClick={copy}><Icon name="copy" />{copied ? "Copied" : "Copy"}</Button>
              {mailto && <ButtonLink plain href={mailto}><Icon name="mail" />Email it</ButtonLink>}
            </div>
            {copyNote && <p className="mt-1.5 text-xs text-ink-3">{copyNote}</p>}
          </div>
        ) : p.active ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusChip tone="green">Active</StatusChip>
            <span className="text-ink-3">Since {shortDate(dateIn(p.active.createdAt, zone))}, {p.active.lastSeenAt ? `last opened ${when(p.active.lastSeenAt)}` : "not opened yet"}</span>
            {p.demoHref && (
              <span className="inline-flex items-center gap-1.5">
                <a href={p.demoHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  Open the tenant&apos;s view<Icon name="arrow-up-right" className="size-3.5" />
                </a>
                <InfoTip align="end" title="The tenants' side">{TENANT_VIEW_TIP}</InfoTip>
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-3">No link yet</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!url && (
            <Button variant={p.active || p.quiet ? "secondary" : "primary"} onClick={create} disabled={busy === "create"}>
              <Icon name="link" />{busy === "create" ? "Making it..." : p.active ? "Make a new link" : "Create tenant link"}
            </Button>
          )}
          {p.active && (
            <Button onClick={revoke} disabled={busy === "revoke"}>{busy === "revoke" ? "Turning it off..." : "Turn off"}</Button>
          )}
        </div>
      </div>
      {dialog}
    </Card>
  );
}
