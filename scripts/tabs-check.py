"""A property's tabs in a real browser, against a running build (cache-check.mjs --live runs it with its throwaway demo
copy A, and puts the change back by removing the copy afterwards):

- a tab switch asks the server for nothing and adds no entry to the browser's history (one entry per property, so
  Back leaves the property);
- after a deduction is changed on Move-out, every way back to it shows the new figures, with the deductions grid and
  the facts above it agreeing: another tab and back, Payments in the sidebar then Back (the property must come back
  within a few seconds, not stay on its skeleton), Back to Properties then Forward;
- on a phone, the grid keeps its narrow columns after a trip to another tab;
- no page error, and no AG Grid warning, on the way.

  GF_BASE=http://localhost:3211 GF_COOKIE='<cookie name>=<value>' GF_UNIT=<an inspected tenancy's id> \\
    python scripts/tabs-check.py

GF_COOKIE is a demo session for the workspace GF_UNIT is in. Prints one line per check, "PASS <name>" or
"FAIL <name>: <detail>", and exits 1 if any failed. It changes one deduction's useful life through the grid and puts it
back. No Claude call, no PayPal write (the property page reads PayPal's invoice, as it always does).
Needs Playwright for Python with Chromium (PLAYWRIGHT_PYTHON, as for scripts/render_pdf.py).
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ["GF_BASE"].rstrip("/")
NAME, _, VALUE = os.environ["GF_COOKIE"].partition("=")
UNIT = os.environ["GF_UNIT"]
PROPERTY = f"/tenancy/{UNIT}"
failed = 0


def check(name, ok, detail=""):
    global failed
    if not ok:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{'' if ok else f': {detail}'}", flush=True)


# The page's own reading of itself: the address, the property's heading, any skeleton still showing, the Move-out
# facts' deductions and the grid's own Deductions line, and the useful-life cells as they read.
STATE = """() => {
  const vis = (e) => !!e && e.checkVisibility();
  const main = document.querySelector('main');
  const text = main ? main.innerText : '';
  const num = (s) => (s ? Number(s.replace(/[^0-9.]/g, '')) : null);
  const fact = (text.match(/Deductions\\n\\$([0-9,.]+)/) || [])[1] || null;
  const total = [...document.querySelectorAll('.gf-deductions .ag-row')].filter(vis).map((r) => r.innerText).find((x) => /^Deductions/.test(x)) || null;
  return {
    path: location.pathname, search: location.search, history: history.length,
    h1: [...document.querySelectorAll('main h1')].filter(vis).map((e) => e.innerText.trim()).join('|'),
    skeleton: [...document.querySelectorAll('[data-skeleton]')].some(vis),
    fact: num(fact), grid: total ? num((total.match(/\\$([0-9,.]+)/) || [])[1]) : null,
    lives: [...document.querySelectorAll(".gf-deductions .ag-cell[col-id='usefulLifeYears']")].filter(vis).map((c) => c.innerText.trim()).filter(Boolean),
    columns: [...new Set([...document.querySelectorAll('.gf-deductions .ag-header-cell')].filter(vis).map((c) => c.getAttribute('col-id')))],
    saved: /Saved\\./.test(text),
  };
}"""
READY = "() => { const vis = (e) => !!e && e.checkVisibility(); return ![...document.querySelectorAll('[data-skeleton]')].some(vis) && [...document.querySelectorAll('main h1')].some(vis); }"
# The property itself drawn (its tab row and heading, no skeleton), not the page before it still on screen.
ON_PROPERTY = ("() => { const vis = (e) => !!e && e.checkVisibility(); return location.pathname === %r"
               " && [...document.querySelectorAll(\"main nav[aria-label='Sections'] a\")].some(vis)"
               " && ![...document.querySelectorAll('[data-skeleton]')].some(vis) && [...document.querySelectorAll('main h1')].some(vis); }") % PROPERTY
ON_UNITS = "() => location.pathname === '/units' && ![...document.querySelectorAll('[data-skeleton]')].some((e) => e.checkVisibility()) && !document.querySelector(\"main nav[aria-label='Sections']\")"


def tab_link(tab):
    return f"main nav[aria-label='Sections'] a[href='{PROPERTY}{'' if tab == 'overview' else f'?tab={tab}'}']"


def open_tab(page, tab):
    page.click(tab_link(tab))
    want = "" if tab == "overview" else f"?tab={tab}"
    page.wait_for_function(f"() => location.search === '{want}'", timeout=5000)
    page.wait_for_function(READY, timeout=10000)
    if tab == "move-out":
        page.wait_for_selector(".gf-deductions .ag-row", timeout=15000)
    page.wait_for_timeout(300)


def within(page, condition, ms):
    try:
        page.wait_for_function(condition, timeout=ms, polling=100)
        return True
    except Exception:
        return False


def agree(name, st, life):
    check(f"{name}: the grid's Deductions line and the facts above it agree", st["fact"] is not None and st["fact"] == st["grid"], f"facts {st['fact']}, grid {st['grid']}")
    check(f"{name}: the changed useful life shows", f"{life} yrs" in st["lives"], f"cells {st['lives']}")


def set_life(page, frm, to):
    before = page.evaluate(STATE)["fact"]
    page.locator(".gf-deductions .ag-cell[col-id='usefulLifeYears']").filter(has_text=re.compile(rf"^{frm} yrs$")).first.click()
    page.wait_for_selector(".gf-deductions input", timeout=5000)
    page.locator(".gf-deductions input").first.fill(str(to))
    page.locator(".gf-deductions input").first.press("Enter")
    page.wait_for_function(
        "(before) => { const t = document.querySelector('main').innerText; const m = t.match(/Deductions\\n\\$([0-9,.]+)/);"
        " return /Saved\\./.test(t) && m && Number(m[1].replace(/,/g, '')) !== before; }", arg=before, timeout=30000)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        problems = []

        # 1440: the tabs, a change, and every way back to it.
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_cookies([{"name": NAME, "value": VALUE, "url": BASE}])
        page = ctx.new_page()
        page.on("pageerror", lambda e: problems.append(f"page error: {str(e)[:160]}"))
        page.on("console", lambda m: problems.append(f"console {m.type}: {m.text[:160]}") if m.type == "error" or "AG Grid" in m.text else None)
        asked = []
        page.on("request", lambda r: asked.append(r.url[len(BASE):][:90]) if r.url.startswith(BASE) and "/_next/static/" not in r.url else None)

        page.goto(BASE + "/units", wait_until="networkidle")
        page.click(f"main a[href='{PROPERTY}']")
        page.wait_for_function(ON_PROPERTY, timeout=15000)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        entries = page.evaluate(STATE)["history"]
        asked.clear()
        for tab in ("move-out", "payments", "documents", "tenants", "overview", "move-out"):
            open_tab(page, tab)
        st = page.evaluate(STATE)
        check("tab switches ask the server for nothing", not asked, f"requests {asked[:4]}")
        check("tab switches add no history entry", st["history"] == entries, f"{entries} entries before, {st['history']} after")
        check("the address names the tab shown", st["search"] == "?tab=move-out", st["search"])
        lives = st["lives"]
        frm = next((int(x.split()[0]) for x in lives if re.fullmatch(r"\d+ yrs", x) and int(x.split()[0]) > 2), None)
        check("Move-out has a deduction with a useful life to change", frm is not None, f"cells {lives}")
        if frm is not None:
            to = frm - 2
            set_life(page, frm, to)
            agree("after the change", page.evaluate(STATE), to)

            open_tab(page, "overview")
            open_tab(page, "move-out")
            agree("Overview and back to Move-out", page.evaluate(STATE), to)

            page.click("aside nav a[href='/ledger']")
            page.wait_for_function("() => location.pathname === '/ledger' && !document.querySelector(\"main nav[aria-label='Sections'] a[href^='/tenancy/']\")", timeout=10000)
            page.wait_for_function(READY, timeout=15000)
            page.wait_for_timeout(300)
            page.go_back()
            back = within(page, ON_PROPERTY, 3000)
            st = page.evaluate(STATE)
            check("Payments, then Back: the property is back within 3 s", back, f"{st['path']}{st['search']}, skeleton {st['skeleton']}, heading '{st['h1']}'")
            check("Payments, then Back: on the tab it was left on", st["search"] == "?tab=move-out", st["search"])
            if back:
                page.wait_for_selector(".gf-deductions .ag-row", timeout=10000)
                page.wait_for_timeout(300)
                agree("Payments, then Back", page.evaluate(STATE), to)

            page.go_back()
            st = page.evaluate(STATE) if within(page, ON_UNITS, 5000) else page.evaluate(STATE)
            check("Back from the property goes to Properties", st["path"] == "/units", f"{st['path']}{st['search']}")
            page.go_forward()
            fwd = within(page, ON_PROPERTY, 3000)
            st = page.evaluate(STATE)
            check("Forward: the property is back within 3 s", fwd, f"{st['path']}{st['search']}, skeleton {st['skeleton']}")
            if fwd:
                page.wait_for_selector(".gf-deductions .ag-row", timeout=10000)
                page.wait_for_timeout(300)
                agree("Back to Properties, then Forward", page.evaluate(STATE), to)
                # And on from there: another page, then Back to the property once more.
                page.click("aside nav a[href='/tenants']")
                page.wait_for_function("() => location.pathname === '/tenants'", timeout=10000)
                page.wait_for_function(READY, timeout=15000)
                page.wait_for_timeout(300)
                page.go_back()
                again = within(page, ON_PROPERTY, 3000)
                st = page.evaluate(STATE)
                check("Forward, Tenants, then Back: the property is back within 3 s", again, f"{st['path']}{st['search']}, skeleton {st['skeleton']}")
                if again:
                    page.wait_for_selector(".gf-deductions .ag-row", timeout=10000)
                    page.wait_for_timeout(300)
                    agree("Forward, Tenants, then Back", page.evaluate(STATE), to)
            page.goto(BASE + PROPERTY + "?tab=move-out", wait_until="networkidle")
            page.wait_for_selector(".gf-deductions .ag-row", timeout=15000)
            page.wait_for_timeout(300)

            set_life(page, to, frm)
            agree("put back", page.evaluate(STATE), frm)
        ctx.close()

        # 390: the grid's narrow columns survive a trip to another tab.
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_cookies([{"name": NAME, "value": VALUE, "url": BASE}])
        page = ctx.new_page()
        page.on("pageerror", lambda e: problems.append(f"page error (390): {str(e)[:160]}"))
        page.on("console", lambda m: problems.append(f"console {m.type} (390): {m.text[:160]}") if m.type == "error" or "AG Grid" in m.text else None)
        page.goto(BASE + PROPERTY + "?tab=move-out", wait_until="networkidle")
        page.wait_for_selector(".gf-deductions .ag-row", timeout=15000)
        page.wait_for_timeout(500)
        first = page.evaluate(STATE)["columns"]
        open_tab(page, "overview")
        open_tab(page, "move-out")
        again = page.evaluate(STATE)["columns"]
        check("390: the grid opens with its narrow columns", first == ["item", "amount", "menu"], f"columns {first}")
        check("390: and keeps them after another tab", again == first, f"{first} then {again}")
        ctx.close()
        browser.close()

        check("no page error or AG Grid warning on the way", not problems, "; ".join(problems[:4]))
    sys.exit(1 if failed else 0)


main()
