// Copying a short string for the reader, in the one place all three copy controls read it from (the PayPal ids on the
// receipt, the tenant page and the Payments drawer, components/copy-id.tsx; the tenant link,
// tenancy/[id]/tenant-link.tsx; a row's Copy PayPal ID in Payments, ledger/ledger-grid.tsx).
//
// The clipboard API exists only on a secure origin (https or localhost) and a browser may refuse it even there, so a
// press must never do nothing: the text is then selected where the reader can see it and the older copy command is
// tried, and when that fails too the caller shows one line saying to copy it by hand. The selection is left in place
// for that, which is why nothing is copied without a node to select: `document.execCommand("copy")` would otherwise
// take whatever the reader happened to have selected and report success.

/** Puts `text` on the clipboard. False means the browser refused both ways; `node` is then left selected, so the
 *  caller can say the text is ready to copy by hand. Without a `node` only the clipboard API is tried. */
export async function copyText(text: string, node?: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* no clipboard, or the browser refused it: fall through */ }
  if (!node) return false;
  if (!selectIn(node)) return false;
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  // Copied the older way: the selection has done its work, so a text node's highlight goes. A field keeps its
  // selection, as it does when a reader selects it themselves.
  if (ok && !(node instanceof HTMLInputElement)) window.getSelection()?.removeAllRanges();
  return ok;
}

/** Selects what the reader should copy by hand: a field's value, or the words of any other element. */
export function selectIn(node: HTMLElement | null): boolean {
  if (!node) return false;
  if (node instanceof HTMLInputElement) {
    node.focus();
    node.select();
    return true;
  }
  const sel = window.getSelection();
  if (!sel) return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}
