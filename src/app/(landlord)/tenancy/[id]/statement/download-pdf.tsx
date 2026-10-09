"use client";

import { useState, type MouseEvent } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";

/** "Download PDF" on the statement. The packet is built on each request (the statement, its photo exhibits, the invoice
 *  copies), which takes a few seconds, and a plain link showed nothing meanwhile. A plain click fetches it here, the
 *  button reads "Preparing PDF..." until it has arrived, and the browser then saves it under the server's file name.
 *  Anything else (a click that opens a new tab, a fetch that fails) is the link itself, which downloads as before. */
export function DownloadPdf({ href, title, className = "" }: { href: string; title?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  async function download(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(href, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "statement.pdf";
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      // The plain download, which shows the server's own answer if it couldn't build the packet.
      window.location.href = href;
    } finally {
      setBusy(false);
    }
  }
  return (
    <a href={href} onClick={download} title={title} aria-busy={busy || undefined} className={buttonClass("primary", "md", className)}>
      <Icon name="download" />{busy ? "Preparing PDF..." : "Download PDF"}
    </a>
  );
}
