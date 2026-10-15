#!/usr/bin/env python3
"""A copy the browser refuses: the Payments row menu's "Copy PayPal ID" must still end with the id on screen, selected,
and one line saying to copy it by hand.

The clipboard API exists only on a secure origin and a browser may refuse it even there (src/lib/clipboard.ts), so the
press has a way out: it opens the row's details, where the same id sits with its own copy button, arriving selected with
one line under it (src/components/copy-id.tsx, src/app/(landlord)/ledger/ledger-grid.tsx). A real browser is the only
place to check that, so this runs Chromium against a production build with the end-to-end test's stubs on, with
navigator.clipboard.writeText and document.execCommand both made to refuse, the way a plain http origin or a browser
without permission leaves the page.

The run is the end-to-end test's (scripts/e2e-demo.py, whose build, server and copy it reuses): a temporary worktree of
HEAD with this checkout's uncommitted changes laid over it, next build, next start on 3211 (or --port) with the stubs
on, a fresh private copy of the demo (never the judges' code), the checks, then the copy, the server and the worktree
removed. No Claude call and no PayPal call is real, and no money moves: it reads one row of Payments and opens a drawer.

  python scripts/clipboard-check.py                       # its own worktree, build, server and copy
  python scripts/clipboard-check.py --worktree <a new dir> --shots <dir>

  # Against a build already made or served (see scripts/e2e-demo.py --prepare and --serve --hold):
  python scripts/clipboard-check.py --serve /tmp/gf-e2e-wt
  python scripts/clipboard-check.py --base http://localhost:3211 --codes /tmp/gf-e2e-hold/codes.json

Prints one line per check, "PASS <name>" or "FAIL <name>: <detail>", then the counts, and exits 1 if any failed (2 if it
couldn't run). A screenshot of the refused copy and the server's log go to --shots. Needs Playwright for Python with
Chromium, and Node.
"""
import argparse
import importlib.util
import json
import os
import re
import signal
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("e2e_demo", REPO / "scripts/e2e-demo.py")
e2e = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(e2e)

# What the row says when the id couldn't be copied for the reader (src/components/copy-id.tsx).
BY_HAND = "Couldn't copy automatically. The ID is selected, so you can copy it by hand."
# A PayPal id as the demo's rows carry one: a sandbox invoice or capture, or the stubbed PayPal's own.
ID = re.compile(r"\b(INV2-[A-Z0-9-]+|E2E[A-Z0-9]+)\b")

# Nothing may reach the real clipboard, and the older copy command refuses too: the state a plain http origin or a
# browser without permission puts the page in.
NO_CLIPBOARD = """
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => ({
    writeText: () => Promise.reject(new DOMException('refused for the test', 'NotAllowedError')),
  }) });
  document.execCommand = () => false;
"""

failed = 0
passed = 0


def check(name, ok, detail=""):
    global failed, passed
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{'' if ok else f': {detail}'}", flush=True)
    return ok


def audit(base, setup, shots):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        ctx.add_cookies([{"name": setup["cookie"]["name"], "value": setup["cookie"]["value"], "url": base}])
        ctx.add_init_script(NO_CLIPBOARD)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text[:200]}") if m.type == "error" else None)
        page.set_default_timeout(30_000)
        page.goto(base + "/ledger", wait_until="networkidle")
        page.locator(".ag-row").first.wait_for()
        # The deposit row's menu, then Copy PayPal ID.
        row = page.locator(".ag-row", has_text="Deposit").first
        row.get_by_role("button", name=re.compile("^More for")).click()
        page.get_by_role("menuitem", name="Copy PayPal ID").click()
        drawer = page.get_by_role("dialog")
        drawer.wait_for(timeout=15_000)
        text = re.sub(r"\s+", " ", drawer.inner_text())
        check("a refused Copy opens the row's details, where the id is", "PayPal" in text, text[:300])
        check("a refused Copy says in one line that the id is selected to copy by hand", BY_HAND in text, text[:400])
        picked = re.sub(r"\s+", " ", page.evaluate("() => String(window.getSelection())")).strip()
        ids = ID.findall(text)
        check("the id itself is the selection, ready for Cmd+C", bool(picked) and picked in ids,
              f"selection {picked!r}, ids on screen {ids}")
        page.screenshot(path=str(shots / "copy-refused.png"), full_page=True)
        check("no page error or console error", not errors, "; ".join(errors[:5]))
        browser.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--worktree", type=Path, help="make a temporary worktree here, build it, serve it on --port, check it, remove it (the default, in a temporary folder)")
    ap.add_argument("--serve", type=Path, help="serve this already-built directory on --port with the stubs on, check it, stop it")
    ap.add_argument("--port", type=int, default=e2e.PORT, help=f"the port --worktree and --serve start the server on (default {e2e.PORT})")
    ap.add_argument("--base", help="check a server already running with the stubs on (with --codes, or its secret and access code in the environment)")
    ap.add_argument("--codes", type=Path, help="with --base: the codes.json an e2e-demo.py --serve --hold server wrote")
    ap.add_argument("--shots", type=Path, help="where the screenshot and the server's log go (default: a new temporary folder)")
    a = ap.parse_args()

    # A stop (SIGTERM from a task runner, SIGALRM from a time limit) ends the run the way Ctrl-C does, so the clean-up
    # below still runs and neither the copy nor the server outlives this script.
    def stopped(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stopped)
    signal.signal(signal.SIGALRM, stopped)

    if sum(bool(x) for x in (a.worktree, a.serve, a.base)) > 1:
        ap.error("pass at most one of --worktree, --serve or --base")
    if a.worktree and a.worktree.exists():
        ap.error(f"{a.worktree} already exists: --worktree makes a new directory (and removes it afterwards)")
    shots = a.shots or Path(tempfile.mkdtemp(prefix="gf-clipboard-"))
    shots.mkdir(parents=True, exist_ok=True)
    server, wt, made, setup, root = None, None, False, None, REPO
    try:
        if a.base:
            base = a.base.rstrip("/")
            saved = json.loads(a.codes.read_text()) if a.codes else {}
            codes = {"secret": saved.get("secret") or os.environ.get("GOOD_FAITH_SESSION_SECRET", ""), "access": saved.get("access") or os.environ.get("GOOD_FAITH_ACCESS_CODE", "")}
            if len(codes["secret"]) < 32 or not codes["access"]:
                raise RuntimeError("--base needs the running server's GOOD_FAITH_SESSION_SECRET and GOOD_FAITH_ACCESS_CODE (or --codes).")
        else:
            wt = a.serve or a.worktree or Path(tempfile.gettempdir()) / f"gf-clipboard-wt-{os.getpid()}"
            if not a.serve:
                made = True
                e2e.make_worktree(wt)
                e2e.build(wt)
            root = wt
            codes = e2e.new_codes()
            server = e2e.start_server(wt, codes, shots / "server.log", a.port)
            base = f"http://localhost:{a.port}"
        up, stubbed = e2e.health(base)
        if not check("the server answers its health check", up):
            return 2
        if not check("the server says the e2e stubs are on, so no Claude or PayPal call can be real", stubbed, "refusing to check a server without the stubs"):
            return 2
        env = {**os.environ, "GOOD_FAITH_SESSION_SECRET": codes["secret"], "GOOD_FAITH_ACCESS_CODE": codes["access"]}
        setup = e2e.helper("setup", env=env, root=root)
        print(f"copy: workspace {setup['ws']}", flush=True)
        audit(base, setup, shots)
    except KeyboardInterrupt:
        check("the run was stopped before it finished", False, "a stop arrived (Ctrl-C, SIGTERM, or SIGALRM from a time limit)")
    except Exception as ex:
        check("the run finished without an error", False, f"{type(ex).__name__}: {ex}")
    finally:
        # A stop that lands here must not cut the clean-up short: the copy below is a row in the live demo's database,
        # and the first stop has already had its effect. So both are held off until the clean-up is done.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGALRM, signal.SIG_IGN)
        if setup:
            try:
                rep = e2e.helper("cleanup", setup["ws"], setup["sid"], root=root)
                check("clean-up: the copy, its rows and files, its fake deposit and its daily-limit rows are gone", rep["ok"], json.dumps(rep))
            except Exception as ex:
                check("clean-up", False, f"{ex}. Run: python scripts/e2e-demo.py --leftovers --apply")
        e2e.stop_server(server)
        if made:
            e2e.remove_worktree(wt)
            check("the temporary worktree is removed", not wt.exists())
        print(f"\nthe screenshot and the server's log: {shots}")
        print(f"{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
