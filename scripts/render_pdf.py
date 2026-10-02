"""Render an HTML file to a Letter-size PDF with headless Chromium, the way demo/lease.pdf and the demo receipts were made.

  python scripts/render_pdf.py demo/lease-single-owner.html demo/lease-single-owner.pdf
  python scripts/render_pdf.py demo/receipts/carpet_invoice.html out.pdf --replace "October 1, 2026=November 5, 2026"

--replace swaps exact text before rendering; demo-seed.mjs uses it to date the receipt exhibits after the move-out.
The page is rendered from its own folder, so a relative stylesheet (demo/receipts/invoice.css) still resolves.
Needs Playwright for Python with Chromium: pip install playwright && playwright install chromium
"""
import argparse
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("html")
    ap.add_argument("pdf")
    ap.add_argument("--replace", action="append", default=[], metavar="OLD=NEW", help="exact text to swap before rendering")
    a = ap.parse_args()
    src = Path(a.html).resolve()
    out = Path(a.pdf).resolve()
    if not src.exists():
        sys.exit(f"{src} not found")
    html = src.read_text()
    for pair in a.replace:
        old, _, new = pair.partition("=")
        if old not in html:
            sys.exit(f"{src.name} does not contain {old!r}; nothing rendered")
        html = html.replace(old, new)
    # A replaced copy sits next to the source so relative links keep working, and is removed afterwards.
    page_file = src.with_name(f".render-{os.getpid()}-{src.name}") if a.replace else src
    try:
        if a.replace:
            page_file.write_text(html)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(page_file.as_uri(), wait_until="load")
            out.parent.mkdir(parents=True, exist_ok=True)
            page.pdf(path=str(out), format="Letter", print_background=True)
            browser.close()
    finally:
        if a.replace:
            page_file.unlink(missing_ok=True)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
