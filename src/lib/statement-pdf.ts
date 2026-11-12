import "server-only";
import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import sharp from "sharp";
import { DEMO_EXAMPLE } from "./copy";
import { db } from "./db";
import { usd } from "./deductions";
import { imageType } from "./images";
import { loadPdf } from "./pdf-guard";
import { packFor } from "./states/server";
import { dateIn, describeDelivery, longDate, type Statement, type StatementPhoto } from "./statement";
import { slots } from "./slots";
import { MAX_PIXELS } from "./uploads";

// The statement as one PDF packet for mail or email: the statement text, then the photo evidence for each deduction
// (in California, Civ. Code 1950.5(g), (h)(2)(D)), then every vendor invoice ((h)(2)(B)). Its statute, deadline and
// citations are the tenancy's state pack's. Built with pdf-lib and the standard fonts,
// so nothing is fetched at runtime but the files in our own buckets. Every file is fetched and embedded before a word
// of the statement is written, so the text says exactly what the packet holds and nothing it does not.

const W = 612, H = 792, M = 54; // US letter, 0.75 inch margins
const TEXT_W = W - 2 * M;
// The app's tokens (globals.css): ink #1B1D23 / #464A58 / #6E7385, brand #003087, line #E6E8EE, amber #946200.
const INK = rgb(0.106, 0.114, 0.137), INK2 = rgb(0.275, 0.29, 0.345), INK3 = rgb(0.431, 0.451, 0.522);
const ACCENT = rgb(0, 0.188, 0.529), LINE = rgb(0.902, 0.91, 0.933), WARN = rgb(0.58, 0.384, 0);

/** Photos are resized to this many pixels on the long side and re-encoded as JPEG before embedding, so a 12 MB phone
 *  photo becomes a few hundred KB and a packet with a dozen photos still fits an email. */
const PHOTO_PX = 1600, PHOTO_QUALITY = 80;
/** Image bytes the packet may carry in all. Past it, photos get a placeholder instead of growing the file without end. */
const IMAGE_BUDGET = 20 * 1024 * 1024;

/** The standard fonts encode WinAnsi only. Swap the characters our text uses that it lacks, then drop anything else
 *  (newlines stay: wrap() turns them into paragraph breaks). */
export function winAnsi(text: string): string {
  return text
    .replace(/×/g, "x")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, "\"")
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[•·]/g, "-")
    .replace(/[^\x20-\x7e\xa1-\xff\n]/g, "");
}

type Fetched = { bytes: Uint8Array; kind: "jpeg" | "png" | "pdf" | "unknown" } | null; // null: no such file

/** File type from the first bytes, never from the extension. */
function sniff(b: Uint8Array): NonNullable<Fetched>["kind"] {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  return "unknown";
}

async function fetchFile(bucket: "photos" | "receipts", path: string): Promise<Fetched> {
  try {
    const { data, error } = await db.storage.from(bucket).download(path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    return { bytes, kind: sniff(bytes) };
  } catch {
    return null;
  }
}

/** Why a file is not in the packet, in the words the statement uses. */
type Why = "missing" | "unsupported" | "budget";
const WHY: Record<Why, string> = {
  missing: "its file could not be found",
  unsupported: "it is in a format this packet can't include",
  budget: "it was left out to keep the packet small enough to send",
};
const WHY_SHORT: Record<Why, string> = { missing: "File not found", unsupported: "Format can't be included", budget: "Left out for size" };

type Embedded = { image: PDFImage } | { why: Why };
type InvoicePlan = { pages: PDFPage[] } | { image: PDFImage } | { why: Why };
type PhotoSlot = { photo: StatementPhoto; embedded: Embedded };
type RowOpts = { size?: number; bold?: boolean; color?: Color };
/** A label, its value and how to draw them, for the rows kept together on one page. */
type Row = [string, string, RowOpts?];

/** A cursor that writes wrapped text down the page and starts a new page when it runs out of room. */
class Writer {
  page!: PDFPage;
  y = 0;

  constructor(readonly doc: PDFDocument, readonly font: PDFFont, readonly bold: PDFFont) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
  }

  need(h: number) {
    if (this.y - h < M) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        for (const piece of this.pieces(word, font, size, width)) {
          const probe = line ? `${line} ${piece}` : piece;
          if (font.widthOfTextAtSize(probe, size) <= width) line = probe;
          else { if (line) lines.push(line); line = piece; }
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** A word wider than the column is cut into pieces that fit, so nothing runs off the page. */
  private pieces(word: string, font: PDFFont, size: number, width: number): string[] {
    if (font.widthOfTextAtSize(word, size) <= width) return [word];
    const out: string[] = [];
    let cur = "";
    for (const ch of word) {
      if (cur && font.widthOfTextAtSize(cur + ch, size) > width) { out.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  text(raw: string, o: { size?: number; font?: PDFFont; color?: Color; x?: number; lead?: number; after?: number } = {}) {
    const size = o.size ?? 10, font = o.font ?? this.font, x = o.x ?? M, lead = o.lead ?? size * 1.4;
    for (const line of this.wrap(winAnsi(raw), font, size, TEXT_W - (x - M))) {
      this.need(lead);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= lead;
    }
    this.y -= o.after ?? 0;
  }

  /** The height text() will take for this, so a block of lines can be kept on one page with need(). */
  textHeight(raw: string, o: { size?: number; font?: PDFFont; x?: number; lead?: number; after?: number } = {}): number {
    const size = o.size ?? 10, x = o.x ?? M, lead = o.lead ?? size * 1.4;
    return this.wrap(winAnsi(raw), o.font ?? this.font, size, TEXT_W - (x - M)).length * lead + (o.after ?? 0);
  }

  /** A label on the left and a value on the right, on one baseline. */
  row(label: string, value: string, o: RowOpts = {}) {
    const size = o.size ?? 10, font = o.bold ? this.bold : this.font, lead = size * 1.5;
    const v = winAnsi(value), vw = font.widthOfTextAtSize(v, size);
    const lines = this.wrap(winAnsi(label), font, size, TEXT_W - vw - 12);
    this.need(lead * lines.length);
    this.page.drawText(v, { x: W - M - vw, y: this.y - size, size, font, color: o.color ?? INK });
    for (const line of lines) {
      this.page.drawText(line, { x: M, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= lead;
    }
  }

  /** The height row() will take for each of these, so a block of rows (the totals) can be kept on one page. */
  rowsHeight(rows: Row[]): number {
    return rows.reduce((h, [label, value, o = {}]) => {
      const size = o.size ?? 10, font = o.bold ? this.bold : this.font;
      const vw = font.widthOfTextAtSize(winAnsi(value), size);
      return h + size * 1.5 * this.wrap(winAnsi(label), font, size, TEXT_W - vw - 12).length;
    }, 0);
  }

  /** Two columns of label and value pairs, as on the statement's header. */
  pairs(items: [string, string][]) {
    const colW = TEXT_W / 2;
    for (let i = 0; i < items.length; i += 2) {
      const pair = items.slice(i, i + 2);
      const wrapped = pair.map(([, v]) => this.wrap(winAnsi(v), this.font, 10, colW - 16));
      const h = 12 + Math.max(...wrapped.map((l) => l.length)) * 13 + 8;
      this.need(h);
      pair.forEach(([label], c) => {
        const x = M + c * colW;
        this.page.drawText(winAnsi(label.toUpperCase()), { x, y: this.y - 8, size: 7.5, font: this.bold, color: INK3 });
        wrapped[c].forEach((line, li) => this.page.drawText(line, { x, y: this.y - 12 - 10 - li * 13, size: 10, font: this.font, color: INK }));
      });
      this.y -= h;
    }
  }

  heading(n: number, title: string, cite?: string) {
    // The heading takes 48, and room for the first lines of its section comes with it (28: two lines of body text),
    // so a heading is never the last thing on a page. A section whose first block reserves more asks for it first.
    this.need(48 + 28);
    this.y -= 12;
    this.rule();
    this.y -= 12;
    this.page.drawText(winAnsi(`${n}. ${title}`), { x: M, y: this.y - 12, size: 12, font: this.bold, color: INK });
    if (cite) {
      const c = winAnsi(cite), cw = this.font.widthOfTextAtSize(c, 8.5);
      this.page.drawText(c, { x: W - M - cw, y: this.y - 11, size: 8.5, font: this.font, color: INK3 });
    }
    this.y -= 24;
  }

  rule(color: Color = LINE, thickness = 0.6) {
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness, color });
  }

  space(h: number) {
    this.y -= h;
  }

  /** Draws an image scaled to fit the box, anchored at its top-left corner. Returns the drawn height. */
  image(img: PDFImage, x: number, top: number, maxW: number, maxH: number): number {
    const k = Math.min(maxW / img.width, maxH / img.height);
    this.page.drawImage(img, { x, y: top - img.height * k, width: img.width * k, height: img.height * k });
    return img.height * k;
  }

  placeholder(x: number, top: number, w: number, h: number, note: string) {
    this.page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: LINE, borderWidth: 0.8 });
    const t = winAnsi(note), tw = this.font.widthOfTextAtSize(t, 9);
    this.page.drawText(t, { x: x + (w - tw) / 2, y: top - h / 2 - 3, size: 9, font: this.font, color: INK3 });
  }
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const fitHeight = (img: PDFImage, maxW: number, maxH: number) => img.height * Math.min(maxW / img.width, maxH / img.height);

/** Exhibit letters A to Z, then AA, AB and so on. */
function letterer() {
  let n = 0;
  return () => {
    let k = n++, s = "";
    do { s = String.fromCharCode(65 + (k % 26)) + s; k = Math.floor(k / 26) - 1; } while (k >= 0);
    return s;
  };
}

/** A photo, downscaled and re-encoded, embedded once per storage path and charged against the image budget. */
async function embedPhoto(doc: PDFDocument, f: Fetched, budget: { left: number }): Promise<Embedded> {
  if (!f) return { why: "missing" };
  if (f.kind !== "jpeg" && f.kind !== "png") return { why: "unsupported" };
  let out: { bytes: Uint8Array; kind: "jpeg" | "png" };
  try {
    // A stored file is checked again before decoding, in case it was stored before the upload check refused its shape
    // (src/lib/images.ts).
    if (!(await imageType(f.bytes))) throw new Error("not a shape the server decodes");
    const small = await sharp(f.bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: PHOTO_PX, height: PHOTO_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: PHOTO_QUALITY }).toBuffer();
    out = { bytes: new Uint8Array(small), kind: "jpeg" };
  } catch {
    // sharp couldn't read it (or it is over MAX_PIXELS, or a shape the upload check refuses): pdf-lib gets an original
    // JPEG, which it embeds without decoding, but not a PNG, which it would decode whole in JavaScript.
    if (f.kind === "png") return { why: "unsupported" };
    out = { bytes: f.bytes, kind: f.kind };
  }
  if (out.bytes.byteLength > budget.left) return { why: "budget" };
  try {
    const image = out.kind === "jpeg" ? await doc.embedJpg(out.bytes) : await doc.embedPng(out.bytes);
    budget.left -= out.bytes.byteLength;
    return { image };
  } catch {
    return { why: "unsupported" };
  }
}

/** A vendor invoice: a PDF's pages copied in (held until the exhibits are laid out), or an image embedded. */
async function planInvoice(doc: PDFDocument, f: Fetched, budget: { left: number }): Promise<InvoicePlan> {
  if (!f) return { why: "missing" };
  if (f.kind === "pdf") {
    try {
      // Within limits (src/lib/pdf-guard.ts): this runs again on every download of the packet.
      const src = await loadPdf(f.bytes);
      const pages = await doc.copyPages(src, src.getPageIndices());
      if (!pages.length) return { why: "unsupported" };
      budget.left -= f.bytes.byteLength;
      return { pages };
    } catch {
      return { why: "unsupported" };
    }
  }
  return embedPhoto(doc, f, budget);
}

/** Packets are built two at a time across the server, with six more waiting their turn. One packet loads every photo
 *  and invoice of the statement at once, so a page of repeated downloads would otherwise hold them all in the one small
 *  server's memory together. A request past those is answered with BUSY. */
export const packetSlot = slots(2, 6);
export const PACKET_BUSY = "Statement packets are being made for other visitors right now. Try again in a few seconds.";

export async function buildStatementPdf(s: Statement): Promise<{ bytes: Uint8Array; pages: number; filename: string }> {
  const pack = packFor(s.state);
  // A timestamp's calendar day where the property is (its pack's zone), as the statement page prints it.
  const onDay = (ts: string) => dateIn(ts, pack.timeZone.id);
  const sec = pack.statement.sections;
  const doc = await PDFDocument.create();
  doc.setTitle(`Itemized security deposit statement, ${s.property.address}`);
  doc.setAuthor(s.landlord);
  doc.setCreator("Good Faith");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);

  // Fetch every file once, then embed: invoices first, since the law requires them and the photo budget bends more
  // easily, then each photo once per storage path.
  const files = new Map<string, Fetched>();
  const paths = new Set<string>();
  for (const d of s.deductions) {
    for (const p of d.photos) paths.add(`photos/${p.path}`);
    if (d.vendor?.invoicePath) paths.add(`receipts/${d.vendor.invoicePath}`);
  }
  await Promise.all([...paths].map(async (key) => {
    const [bucket, ...rest] = key.split("/");
    files.set(key, await fetchFile(bucket as "photos" | "receipts", rest.join("/")));
  }));
  const budget = { left: IMAGE_BUDGET };
  const invoicePlan = new Map<string, InvoicePlan>();
  for (const d of s.deductions) {
    if (d.vendor?.invoicePath) invoicePlan.set(d.id, await planInvoice(doc, files.get(`receipts/${d.vendor.invoicePath}`) ?? null, budget));
  }
  const images = new Map<string, Embedded>();
  const photoPlan = new Map<string, PhotoSlot[]>();
  for (const d of s.deductions) {
    const slots: PhotoSlot[] = [];
    for (const p of d.photos) {
      if (!images.has(p.path)) images.set(p.path, await embedPhoto(doc, files.get(`photos/${p.path}`) ?? null, budget));
      slots.push({ photo: p, embedded: images.get(p.path)! });
    }
    photoPlan.set(d.id, slots);
  }

  // Exhibit letters go only to what is in the packet; the rest is named in "Not included".
  const letter = letterer();
  const photoExhibit = new Map<string, string>(), invoiceExhibit = new Map<string, string>();
  const attached: string[] = [], notIncluded: string[] = [];
  for (const d of s.deductions) {
    const slots = photoPlan.get(d.id) ?? [];
    if (slots.some((x) => "image" in x.embedded)) {
      const L = letter();
      photoExhibit.set(d.id, L);
      attached.push(`Exhibit ${L}, photos for item ${d.n}`);
    }
    const out = slots.filter((x) => "why" in x.embedded);
    if (out.length) notIncluded.push(`photos for item ${d.n} (${out.map((x) => `${x.photo.label.toLowerCase()}: ${WHY[(x.embedded as { why: Why }).why]}`).join("; ")})`);
  }
  for (const d of s.deductions) {
    const plan = invoicePlan.get(d.id);
    if (!plan) continue;
    if ("why" in plan) notIncluded.push(`the invoice from ${d.vendor!.name ?? "the vendor"} for item ${d.n} (${WHY[plan.why]})`);
    else {
      const L = letter();
      invoiceExhibit.set(d.id, L);
      attached.push(`Exhibit ${L}, invoice from ${d.vendor!.name ?? "the vendor"} for item ${d.n}`);
    }
  }

  // Header (checklist item 1). The countdown is for the landlord while the statement is a draft; a delivered
  // statement is frozen on its date and carries none.
  w.text("ITEMIZED SECURITY DEPOSIT STATEMENT", { size: 9, font: bold, color: ACCENT, lead: 16 });
  w.text(s.property.address, { size: 18, font: bold, lead: 24 });
  w.text(pack.copy.statementCite, { size: 9.5, color: INK3, after: 12 });
  const dueLine = s.daysLeft == null ? "" : s.daysLeft < 0 ? ` (${-s.daysLeft} day${s.daysLeft === -1 ? "" : "s"} late)` : s.daysLeft === 0 ? " (due today)" : ` (${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left)`;
  w.pairs([
    ["From", s.landlord], ["To", s.tenants.join(" and ")],
    ["Moved out", s.moveOutDate ? longDate(s.moveOutDate) : "Not set"], ["Statement date", longDate(s.statementDate)],
    ["Due by", `${s.statementDue ? longDate(s.statementDue) : "Not set"}${dueLine}`], ["Deadline", pack.statement.pdf.deadlineLine],
    // The amended statement: a settlement of the tenants' dispute, paid.
    ...(s.settlement ? [
      ["Amended", s.settlement.sentAt ? longDate(onDay(s.settlement.sentAt)) : "By settlement"],
      ["Settlement", `${usd(s.settlement.amount)} more back to the tenants`],
    ] as [string, string][] : []),
  ]);

  // 1. Security received.
  let n = 0;
  w.heading(++n, "Security received", sec.security.cite);
  if (s.security) {
    w.text(usd(s.security.amount), { size: 16, font: bold, lead: 20 });
    const method = !s.security.method || s.security.method === "PAYPAL" ? "PayPal" : s.security.method.toLowerCase().replace(/_/g, " ");
    w.text(s.security.paid
      ? `Paid ${s.security.paidAt ? `on ${longDate(onDay(s.security.paidAt))} ` : ""}by ${method}, PayPal invoice ${s.security.invoiceId}.`
      : `PayPal invoice ${s.security.invoiceId} is ${s.security.invoiceStatus.toLowerCase().replace(/_/g, " ")}, not paid.`, { color: INK2, after: 4 });
    if (!s.security.live) w.text("PayPal could not be reached when this was prepared; the payment is shown as last recorded.", { size: 9.5, color: INK3, after: 4 });
    if (s.security.basisNote) w.text(s.security.basisNote, { size: 9.5, color: INK2 });
  } else {
    w.text("No security deposit was collected through PayPal for this tenancy.", { color: INK2 });
  }

  // 2. Deductions, one block each (items 3 to 8). Numbered "Item n" so they never read as section numbers. Each
  // block reserves 70 below, so the heading reserves that much with itself and is never left alone at a page's foot.
  w.need(48 + 70);
  w.heading(++n, "Deductions", sec.deductions.cite);
  // How the claim stands, when it is not a plain deduction (Florida: disputed; New York: kept after day 14).
  if (s.standing) w.text(`${s.standing.label}. ${s.standing.note}`, { size: 9.5, color: WARN, after: 8 });
  if (!s.deductions.length) w.text(s.totals.depositHeld === 0 ? "No deductions." : "No deductions. The whole security is refunded.", { color: INK2 });
  for (const d of s.deductions) {
    w.need(70);
    w.row(`Item ${d.n}. ${d.item}${d.room ? ` (${d.room})` : ""}`, usd(d.amount), { bold: true, size: 10.5 });
    w.text(`${d.tag} ${d.tagLabel}`, { size: 9, color: INK2, lead: 13 });
    const at = M + 14;
    // The stored math already carries its own label when it is a plain invoice ("Vendor invoice: $140.00").
    w.text(`${d.explanation.includes("=") ? `Cost: ${d.explanation}` : d.explanation}${d.guidance ? ` (prorated by ${d.proration === "useful_life" ? "useful life" : "the paint schedule"}: ${pack.copy.guidanceLabel}, not statute)` : ""}`, { size: 9.5, color: INK2, x: at });
    if (d.note) w.text(`Why this work: ${d.note}`, { size: 9.5, color: INK2, x: at });
    if (d.labor) {
      w.text(`Work by the landlord: ${d.labor.description ?? "no description recorded"}. ${d.labor.hours ?? "?"} hour${d.labor.hours === 1 ? "" : "s"} at ${d.labor.hourlyRate == null ? "an unrecorded rate" : `${usd(d.labor.hourlyRate)} an hour`}.`, { size: 9.5, color: INK2, x: at });
    }
    if (d.vendor) {
      const contact = [d.vendor.name, d.vendor.address, d.vendor.phone].filter(Boolean).join(", ") || "not recorded";
      const plan = invoicePlan.get(d.id);
      const inv = invoiceExhibit.has(d.id) ? `Invoice attached as Exhibit ${invoiceExhibit.get(d.id)}.`
        : !d.vendor.invoicePath ? (d.isEstimate ? "Estimate; the invoice follows when received." : "Invoice not on file.")
          : plan && "why" in plan ? `Invoice on file but not included: ${WHY[plan.why]}.` : "Invoice on file but not included.";
      w.text(`Vendor: ${contact}. ${inv}`, { size: 9.5, color: INK2, x: at });
    }
    if (d.isEstimate) {
      w.text(pack.statement.estimateNote, { size: 9.5, color: WARN, x: at });
    }
    const slots = photoPlan.get(d.id) ?? [];
    const shown = slots.filter((x) => "image" in x.embedded).map((x) => x.photo.label.toLowerCase());
    const out = slots.filter((x) => "why" in x.embedded).map((x) => x.photo.label.toLowerCase());
    w.text(photoExhibit.has(d.id)
      ? `Photos: Exhibit ${photoExhibit.get(d.id)} (${shown.join("; ")})${out.length ? `; not available: ${out.join("; ")}` : ""}.`
      : slots.length ? `Photos: on file but not available for this packet (${out.join("; ")}).` : "Photos: none on file.", { size: 9.5, color: INK2, x: at, after: 8 });
  }
  // Considered and not charged: the wear-and-tear findings at $0, where the state's spec lists them.
  if (s.wear?.length) {
    w.need(30);
    w.text("Considered and not charged (normal wear and tear)", { size: 10, font: bold, after: 2 });
    for (const x of s.wear) w.row(`${x.item} (${x.room})`, usd(0), { size: 9.5, color: INK2 });
    w.space(6);
  }
  // The totals, gathered first and then kept on one page with the rule over them: paged row by row, "Refunded
  // $3,790.00" could open a page alone, cut off from the two lines that add up to it.
  // Forfeited deductions (New York after day 14) stay listed as claimed, come back off here, and leave the whole
  // security owed; a claim over the deposit is then a separate matter, so no balance is totalled.
  const forfeits = !!s.standing?.forfeits;
  const sent = s.refund.state === "sent";
  const totals: Row[] = [];
  totals.push(["Security held", usd(s.totals.depositHeld)]);
  totals.push([s.standing && !forfeits ? s.standing.label : "Total deductions", s.totals.deductions ? `-${usd(s.totals.deductions)}` : usd(0)]);
  if (forfeits) totals.push([s.standing!.label, `+${usd(s.totals.deductions)}`]);
  // PayPal's refund through the tenants' PayPal dispute: past the refund owed, the deductions it covered aren't kept.
  const via = s.viaDispute;
  // Refunds made in PayPal and recorded as this deposit's refund: the refund itself when they cover it (asRefund),
  // else a line before it.
  const outside = s.outside && !s.outside.asRefund ? s.outside : null;
  const prior = (via?.amount ?? 0) + (outside?.amount ?? 0);
  if (via && via.notKept > 0) totals.push(["Not kept, after the PayPal dispute", `+${usd(via.notKept)}`]);
  if (s.outside && s.outside.notKept > 0) totals.push(["Not kept, after the refund in PayPal", `+${usd(s.outside.notKept)}`]);
  if (via) totals.push(["Returned through the PayPal dispute", `-${usd(via.amount)}`]);
  if (outside) totals.push(["Refunded in PayPal", `-${usd(outside.amount)}`]);
  if (s.balanceClaimed && !forfeits) totals.push(["Balance claimed", usd(s.balanceClaimed.amount), { bold: true, size: 11.5 }]);
  else totals.push([sent ? "Refunded" : forfeits ? "Owed back" : prior ? "Left to refund" : "Refund", usd(s.refund.amount), { bold: true, size: 11.5 }]);
  const stillOwed = forfeits && sent ? Math.max(0, Math.round((s.totals.depositHeld - s.refund.amount - (s.settlement?.amount ?? 0) - prior) * 100) / 100) : 0;
  if (stillOwed > 0) totals.push(["Still owed", usd(stillOwed)]);
  w.need(2 + 10 + w.rowsHeight(totals));
  w.space(2);
  w.rule(INK, 1);
  w.space(10);
  for (const [label, value, o] of totals) w.row(label, value, o);

  // 3. Documents (item 9): the rule, then exactly what this packet holds and what it does not.
  w.heading(++n, "Documents", pack.statement.documentsCite(s.documents.required));
  w.text(s.documents.note, { color: INK2 });
  if (s.deductions.some((d) => d.category !== "rent")) {
    w.space(4);
    if (attached.length) w.text(`${s.documents.required ? "Attached" : "Attached anyway"}: ${attached.join("; ")}. The labor records are in the deduction lines above.`, { size: 9.5, color: INK2 });
    else w.text("No photos or invoices are attached to this packet.", { size: 9.5, color: INK2 });
    if (notIncluded.length) w.text(`Not included: ${notIncluded.join("; ")}.`, { size: 9.5, color: WARN });
  }

  // 4. Refund (item 10).
  w.heading(++n, "Refund", sec.refund);
  if (via) {
    w.text(`Returned through the tenants' PayPal dispute: ${usd(via.amount)}${via.disputeId ? ` (dispute ${via.disputeId})` : ""}${via.at ? `, ${longDate(onDay(via.at))}` : ""}.${via.notKept > 0 ? ` That is more than this statement's refund, so ${usd(via.notKept)} of the deductions above is not kept.` : ""}`, { color: INK2, after: 4 });
  }
  for (const r of outside?.refunds ?? []) {
    w.text(`Refunded in PayPal: ${usd(r.amount)} (PayPal id ${r.id})${r.at ? `, ${longDate(onDay(r.at))}` : ""}.`, { color: INK2, after: 4 });
  }
  if (s.outside && s.outside.notKept > 0) w.text(`More was refunded in PayPal than this statement's refund, so ${usd(s.outside.notKept)} of the deductions above is not kept.`, { color: INK2, after: 4 });
  w.text(usd(s.refund.amount), { size: 16, font: bold, lead: 20 });
  w.text(`${s.refund.method}${s.refund.paypalId ? ` (PayPal id ${s.refund.paypalId})` : ""}${s.refund.sentAt ? `, sent ${longDate(onDay(s.refund.sentAt))}` : ""}${s.refund.state === "none" ? "" : "."}`, { color: INK2 });
  if (s.refund.state !== "none") w.text(`Payable to ${s.refund.payees.join(" and ")}${s.refund.paypalEmail ? `, PayPal account ${s.refund.paypalEmail}` : ""}.`, { color: INK2 });
  if (s.refund.note) { w.space(4); w.text(s.refund.note, { size: 9.5, color: INK3 }); }

  // The settlement that amends the statement: who accepted and approved it, each charge it changed, the new totals and
  // the PayPal record of the extra amount.
  if (s.settlement) {
    const st = s.settlement;
    w.heading(++n, "Settlement (amended statement)");
    w.text(`The tenants disputed this statement. ${st.acceptedBy ?? "The tenants"} accepted the settlement${st.acceptedAt ? ` on ${longDate(onDay(st.acceptedAt))}` : ""}, and ${s.landlord} approved it${st.approvedAt ? ` on ${longDate(onDay(st.approvedAt))}` : ""}. It amends the deductions above as follows.`, { color: INK2, after: 6 });
    for (const l of st.lines) w.row(`Item ${l.n}. ${l.item}: kept ${usd(l.keep)} of ${usd(l.amount)}`, `-${usd(-l.adjustment)}`, { size: 9.5, color: INK2 });
    w.space(6);
    w.row("Deductions on the statement", usd(s.totals.deductions));
    w.row("Agreed adjustment", st.adjustment ? `-${usd(-st.adjustment)}` : usd(0));
    w.row("Deductions as settled", usd(st.keptAfter));
    w.row(st.refundSent ? "Refunded with the statement" : "Refund due with the statement, not sent yet", usd(s.refund.amount));
    w.row("Settlement", usd(st.amount));
    w.row("Returned in all", usd(st.returnedInAll), { bold: true, size: 11.5 });
    if (st.balanceAfter > 0) w.row("Balance still claimed", usd(st.balanceAfter));
    w.space(4);
    w.text(st.example ? `${DEMO_EXAMPLE.short}. ${DEMO_EXAMPLE.text}`
      : st.paypalId
        ? `${st.rail === "payout" ? "PayPal Payout to the account the tenants designated" : "PayPal refund of the original deposit payment"} (PayPal id ${st.paypalId})${st.sentAt ? `, sent ${longDate(onDay(st.sentAt))}` : ""}.`
        : st.refundSent && s.refund.amount >= s.totals.depositHeld - 0.005
          ? "No money moved: the whole deposit had already gone back with the statement."
          : "No money moved: the deposit was used in full, and the balance claimed went down.", { color: INK2 });
  }

  // 5. Local deposit interest (item 11).
  w.heading(++n, pack.statement.interestTitle);
  w.text(s.interest.note, { color: INK2 });

  // 6. Balance claimed (item 12), only when there is one.
  if (s.balanceClaimed) {
    w.heading(++n, "Balance claimed");
    w.text(usd(s.balanceClaimed.amount), { size: 16, font: bold, lead: 20 });
    w.text(s.balanceClaimed.text, { color: INK2 });
  }

  // 7. Delivery (item 13), kept on one page with the closing lines under it: the attachments line and the section F
  // lines that speak to both parties. Paged on their own, those four lines of fine print could land alone on a page
  // of their own between the statement and Exhibit A.
  const delivered = s.delivery
    ? `Delivered by ${describeDelivery(s.delivery, s.deliveryRecordedOn)}${s.delivery.to && s.delivery.method !== "personal" ? `, addressed to ${s.delivery.to}` : ""}.`
    : "To be recorded when the statement goes out.";
  const attachedLine = attached.length > 1 ? `Exhibits A through ${[...photoExhibit.values(), ...invoiceExhibit.values()].pop()} follow this statement.`
    : attached.length ? "Exhibit A follows this statement." : "No attachments.";
  const closing: [string, { size: number; lead?: number; after?: number }][] = [
    [attachedLine, { size: 9, after: 6 }],
    [pack.copy.preparedUnder, { size: 8, lead: 11 }],
    [pack.copy.disclaimers[1], { size: 8, lead: 11 }],
    [pack.copy.disclaimers[3], { size: 8, lead: 11 }],
  ];
  w.need(48 + w.textHeight(delivered) + 14 + 10 + closing.reduce((h, [line, o]) => h + w.textHeight(line, o), 0));
  w.heading(++n, "Delivery", sec.delivery.cite);
  w.text(delivered, { color: s.delivery ? INK2 : INK3 });
  w.space(14);
  w.rule();
  w.space(10);
  w.text(attachedLine, { size: 9, color: INK2, after: 6 });
  for (const [line, o] of closing.slice(1)) w.text(line, { ...o, color: INK3 });

  // Photo exhibits: the move-in, before and after photos of one deduction in a row, as on screen, each row as tall
  // as its tallest photo. Exhibits follow one another down the page and start a new one only when the next would
  // not fit, so the packet stays short enough to mail.
  const gap = 10, labelH = 14, maxImgH = 300, placeholderH = 110;
  let firstExhibit = true;
  for (const d of s.deductions) {
    const L = photoExhibit.get(d.id);
    if (!L) continue;
    const slots = photoPlan.get(d.id)!;
    const cols = Math.min(3, Math.max(1, slots.length)), cellW = (TEXT_W - gap * (cols - 1)) / cols;
    const rowH = (row: PhotoSlot[]) => Math.max(...row.map((x) => ("image" in x.embedded ? fitHeight(x.embedded.image, cellW, maxImgH) : placeholderH))) + labelH;
    const firstRow = rowH(slots.slice(0, cols));
    if (firstExhibit || w.y - (72 + firstRow) < M) w.newPage();
    else { w.space(16); w.rule(); w.space(14); }
    firstExhibit = false;
    w.text(`EXHIBIT ${L}`, { size: 9, font: bold, color: ACCENT, lead: 16 });
    w.text(`Photos for item ${d.n}: ${d.item}${d.room ? ` (${d.room})` : ""}`, { size: 13, font: bold, lead: 18 });
    w.text(`${d.tag} ${d.tagLabel}. ${d.explanation}${d.note ? ` ${d.note}` : ""}`, { size: 9.5, color: INK2, after: 10 });
    for (let i = 0; i < slots.length; i += cols) {
      const row = slots.slice(i, i + cols), h = rowH(row);
      if (w.y - h < M) w.newPage();
      const top = w.y;
      row.forEach((x, c) => {
        const left = M + c * (cellW + gap);
        w.page.drawText(winAnsi(x.photo.label.toUpperCase()), { x: left, y: top - 9, size: 7.5, font: bold, color: INK3 });
        if ("image" in x.embedded) w.image(x.embedded.image, left, top - labelH, cellW, maxImgH);
        else w.placeholder(left, top - labelH, cellW, placeholderH, WHY_SHORT[x.embedded.why]);
      });
      w.y = top - h - gap;
    }
  }

  // Vendor invoices: a PDF's pages are copied in behind an exhibit label; an image invoice gets a page of its own.
  for (const d of s.deductions) {
    const L = invoiceExhibit.get(d.id);
    if (!L) continue;
    const plan = invoicePlan.get(d.id)!;
    const title = `Invoice from ${d.vendor!.name ?? "the vendor"} for item ${d.n}: ${d.item}`;
    if ("pages" in plan) {
      plan.pages.forEach((p, i) => {
        doc.addPage(p);
        if (i === 0) {
          try {
            const { height } = p.getSize();
            const label = `EXHIBIT ${L}`;
            p.drawText(label, { x: M, y: height - 26, size: 9, font: bold, color: ACCENT });
            p.drawText(winAnsi(title), { x: M + bold.widthOfTextAtSize(label, 9) + 10, y: height - 26, size: 8, font, color: INK3 });
          } catch { /* an unlabeled copy is still the invoice */ }
        }
      });
      continue;
    }
    w.newPage();
    w.text(`EXHIBIT ${L}`, { size: 9, font: bold, color: ACCENT, lead: 16 });
    w.text(title, { size: 13, font: bold, lead: 18, after: 10 });
    if ("image" in plan) w.image(plan.image, M, w.y, TEXT_W, w.y - M);
  }

  // The same footer on every page, copied invoices included, so the packet reads as one document.
  const pages = doc.getPages();
  const left = winAnsi(`${s.property.address}  |  Itemized security deposit statement, ${longDate(s.statementDate)}${s.settlement ? " (amended)" : ""}`);
  pages.forEach((p, i) => {
    try {
      const { width } = p.getSize();
      const right = `Page ${i + 1} of ${pages.length}`;
      p.drawText(left, { x: M, y: 30, size: 8, font, color: INK3 });
      p.drawText(right, { x: width - M - font.widthOfTextAtSize(right, 8), y: 30, size: 8, font, color: INK3 });
    } catch { /* a copied page that refuses a footer keeps its own */ }
  });

  return { bytes: await doc.save(), pages: pages.length, filename: `deposit-statement-${slug(s.property.address)}-${s.statementDate}.pdf` };
}
