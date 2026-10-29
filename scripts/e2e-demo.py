#!/usr/bin/env python3
"""The judges' path, end to end, on a production build, with every model and PayPal stubbed.

It walks docs/DEMO_SCRIPT.md in a real browser on a fresh private demo copy, as a judge would, and checks at each step
the words that matter and every money figure against what the code computes, saving a screenshot of each step:

   0. The welcome card on a first visit to Properties, in the copy's own words; its four-stop tour, each stop's ring
      around its own part of the page, at computer and phone width; its last button to the move-out photos; seen
      once (Back from the refund review included), then again from the menu; a page change under the tour ends it.
      At the end (12d) it is opened again and says the deposit is closed out
   1. Properties: the three units, the Texas unit's Rules chip (beat 8), and the demo guide's eight beats, each
      ticked off this copy's own rows and linking to where that beat happens in it
   2. Check a lease: the sample in one click (no Claude call), then demo/lease-single-owner.pdf uploaded, its flags
      and the lawful deposit (beat 1)
   3. The move-out unit's Overview: the deposit paid through a PayPal invoice, the signed refund agreement (beat 2)
   4. Move-out: the move-in and move-out photo pairs with Claude's damage boxes, the three deductions (beat 3)
   5. Review refund: the rail in words with PayPal's window from refund-rail.ts, the close-out agent's plan, its
      steps, the approval, the receipt, and on it "PayPal's record": the refund read back from the fake PayPal, its
      fields against what the fake answered when the refund was made, and Check again reading it again (beat 4)
   6. The itemized statement and its delivery, then the tenants' page (before beat 5)
   7. The tenants' dispute and their advocate's case (beat 5)
   8. The two agents' negotiation (beat 6)
   9. The settlement: the tenants accept, the landlord approves and pays, the amended statement (beat 7)
      In 8 and 9 the two pages stay open side by side, as in the demo: each shows what the other side did without a
      reload (the settlement the agents reached, the tenants' acceptance, the payment), and stops asking once settled
  10. Payments (the AG Grid ledger), with PayPal's record in the details of the refund, the settlement and the deposit
      rows, each against what the fake PayPal holds, and Insights (beat 3b)
  11. The same lease twice: Start tenancy on a lease the copy already has opens that tenancy, and makes no second one
  12. The demo guide's own ground: a move-out date set on the Texas unit leaves every step where it was (the unit each
      beat runs on is the address the demo script names, not the copy's latest move-out); its route answers with the
      copy's eight steps; a click from one page to another makes it read them again rather than keep the last page's;
      and Hide puts it away for the browser, a reload keeps it away, the account menu brings it back. Its eight steps
      and the two properties they name are also checked against the beat table of docs/DEMO_SCRIPT.md, with no browser

The server runs with GOOD_FAITH_E2E_STUBS=1 (src/lib/e2e-switch.ts): every Claude job answers from a scripted stub,
Jev is off, and every PayPal call goes to a fake PayPal inside the server that refunds only the test's own fake
deposit. The switch works only off Render and never with live PayPal, and the server says so loudly in its log; this
script refuses a server whose /api/health doesn't carry the stubs' header. It also starts the server with made-up
PayPal and Anthropic keys, so a call that ever slipped past the stubs would be refused, not served. No Claude call, no
PayPal request, no money.

The copy is the test's own (scripts/e2e-demo-db.mjs): made from the templates as a visitor's is, with a fake deposit
of its own, and a demo session signed locally with the test server's secret, never the judges' code (no
demo_copy_usage row, none of the day's 60 copies). Everything the test makes is removed at the end, failed or not:
the daily-limit units it took go back to the day's totals, then its fake deposit, its copy's rows and files.

  # The whole run (the checklist's): a temporary worktree of HEAD with this checkout's uncommitted changes laid over
  # it, node_modules cloned in (APFS), .env.local copied, next build, next start on 3211 (or --port) with the stubs on,
  # the walk, then everything removed. The worktree's directory must not exist yet.
  /path/to/python scripts/e2e-demo.py --worktree /tmp/gf-e2e-wt --shots /tmp/gf-e2e-shots

  # The same in steps, to walk one build several times: build it, serve it with the stubs on and keep it up, walk it.
  # A worktree kept this way (--prepare, --keep-worktree) holds a copy of .env.local, real secrets included, until it
  # is removed (git worktree remove --force <dir>).
  python scripts/e2e-demo.py --worktree /tmp/gf-e2e-wt --prepare
  python scripts/e2e-demo.py --serve /tmp/gf-e2e-wt --hold --shots /tmp/gf-e2e-hold      # until stopped
  python scripts/e2e-demo.py --base http://localhost:3211 --codes /tmp/gf-e2e-hold/codes.json --shots /tmp/gf-e2e-shots
  python scripts/e2e-demo.py --serve /tmp/gf-e2e-wt --shots /tmp/gf-e2e-shots          # serve, walk and stop in one

  # --base reads the held server's log for the log checks (the banner, the stubs answering, no real call): --log, by
  # default the server.log beside --codes, only the part this run added. Without a log it says it skipped them, and
  # the health check's stubs header is then the only guard.

  # Copies an earlier run left behind (it crashed before its clean-up): list, then remove.
  python scripts/e2e-demo.py --leftovers [--apply]

Prints one line per check, "PASS <name>" or "FAIL <name>: <detail>", and exits 1 if any failed (2 if it couldn't run).
Needs Playwright for Python with Chromium, and Node for the build and scripts/e2e-demo-db.mjs.
"""
import argparse
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PORT = 3211  # the default; --port picks another, for a run beside one already on 3211
STUB_HEADER = "x-good-faith-e2e-stubs"

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


def usd(n):
    return f"${n:,.2f}"


def cents(n):
    return round(float(n) + 1e-9, 2)


# ---------- The build and the server ----------

def run(cmd, **kw):
    r = subprocess.run(cmd, text=True, capture_output=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(map(str, cmd))} failed ({r.returncode}): {(r.stderr or r.stdout)[-1500:]}")
    return r.stdout


def make_worktree(wt: Path):
    """HEAD in a new worktree, with this checkout's uncommitted changes (modified, added, deleted, untracked) laid over
    it, so the test runs the code as it stands now."""
    if wt.exists():
        raise RuntimeError(f"{wt} already exists: pass a new directory for the worktree.")
    run(["git", "-C", str(REPO), "worktree", "add", "--detach", str(wt), "HEAD"])
    changed = run(["git", "-C", str(REPO), "diff", "--name-only", "--diff-filter=d", "HEAD"]).split()
    untracked = run(["git", "-C", str(REPO), "ls-files", "--others", "--exclude-standard"]).split()
    deleted = run(["git", "-C", str(REPO), "diff", "--name-only", "--diff-filter=D", "HEAD"]).split()
    for rel in changed + untracked:
        src, dst = REPO / rel, wt / rel
        if src.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    for rel in deleted:
        (wt / rel).unlink(missing_ok=True)
    # Turbopack refuses a symlinked node_modules; an APFS clone costs no space.
    run(["cp", "-c", "-R", str(REPO / "node_modules"), str(wt / "node_modules")])
    shutil.copy2(REPO / ".env.local", wt / ".env.local")
    print(f"worktree: {wt} (HEAD plus {len(changed) + len(untracked)} changed and {len(deleted)} deleted files)", flush=True)


def remove_worktree(wt: Path):
    subprocess.run(["git", "-C", str(REPO), "worktree", "remove", "--force", str(wt)], capture_output=True, text=True)
    if wt.exists():
        shutil.rmtree(wt, ignore_errors=True)
    subprocess.run(["git", "-C", str(REPO), "worktree", "prune"], capture_output=True, text=True)


def build(wt: Path):
    t = time.time()
    r = subprocess.run([str(wt / "node_modules/.bin/next"), "build"], cwd=wt, text=True, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"next build failed: {(r.stdout + r.stderr)[-3000:]}")
    print(f"next build: done in {time.time() - t:.0f}s", flush=True)


def stub_env(codes):
    """The test server's environment: the stubs on, test codes, and made-up PayPal and Anthropic keys, so nothing that
    slipped past the stubs could reach either. The real ones in .env.local never load over these (Next keeps what the
    environment already has)."""
    # On Render (RENDER and its kin set) the stubs stay off whatever this sets, and the health check then refuses.
    env = dict(os.environ)
    env.update({
        "GOOD_FAITH_E2E_STUBS": "1",
        "GOOD_FAITH_ACCESS_CODE": codes["access"], "GOOD_FAITH_OWNER_CODE": codes["owner"], "GOOD_FAITH_SESSION_SECRET": codes["secret"],
        "PAYPAL_ENVIRONMENT": "SANDBOX", "PAYPAL_CLIENT_ID": "e2e-stub-not-a-paypal-client", "PAYPAL_CLIENT_SECRET": "e2e-stub-not-a-paypal-secret",
        "PAYPAL_WEBHOOK_ID": "E2E-NO-WEBHOOK", "ANTHROPIC_API_KEY": "e2e-stub-not-an-anthropic-key", "TYPESAFE_API_KEY": "",
        "NODE_ENV": "production",
    })
    return env


def new_codes():
    return {"access": f"e2e-{secrets.token_hex(12)}", "owner": f"e2e-owner-{secrets.token_hex(12)}", "secret": secrets.token_urlsafe(48)}


def start_server(wt: Path, codes, log: Path, port: int):
    if port_busy(port):
        raise RuntimeError(f"Port {port} is in use: stop that server first, or pass another --port.")
    out = open(log, "w")
    p = subprocess.Popen([str(wt / "node_modules/.bin/next"), "start", "-p", str(port)], cwd=wt, env=stub_env(codes),
                         stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
    return p


def stop_server(p):
    if p and p.poll() is None:
        try:
            os.killpg(p.pid, signal.SIGTERM)
            p.wait(timeout=20)
        except Exception:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except Exception:
                pass


def port_busy(port):
    import socket
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def health(base, timeout=90):
    """The server's health check, and whether it says the stubs are on."""
    until = time.time() + timeout
    last = None
    while time.time() < until:
        try:
            with urllib.request.urlopen(f"{base}/api/health", timeout=5) as r:
                return r.status == 200, (r.headers.get(STUB_HEADER) or "").lower() == "on"
        except Exception as e:  # not up yet
            last = e
            time.sleep(1)
    raise RuntimeError(f"{base}/api/health never answered: {last}")


STUB_JOBS = ("lease", "close_out", "advocate", "negotiator")
REAL_CALL_SIGNS = ("PayPal auth failed", "PayPal invoice lookup failed", "close-out run failed", "x-api-key", "invalid x-api-key", "Unhandled", "E2E_NOT_STUBBED")


def server_log_checks(whole, this_run):
    """The server's own word that the run was stubbed: the banner it prints at start (anywhere in its log), and for the
    lines this run added, a stub answer for each Claude job and no sign of a real PayPal or Claude call."""
    check("the server's log carries the stubs' banner", "[E2E STUBS ON] GOOD_FAITH_E2E_STUBS=1" in whole)
    missing = [j for j in STUB_JOBS if f"stub model answered a {j} call" not in this_run]
    check("the stubs answered the Claude jobs (lease, close-out, advocate, negotiator)", not missing, "missing: " + ", ".join(missing))
    n = this_run.count("stub model answered a lease call")
    check("the sample lease made no Claude call: the stub answered the two uploads of the lease and nothing more", n == 2, f"{n} lease answers")
    bad = [w for w in REAL_CALL_SIGNS if w in this_run]
    check("the server's log shows no real PayPal or Claude call and no unhandled error", not bad, ", ".join(bad))


# ---------- The database helper ----------

def helper(*args, env=None, root=REPO):
    r = subprocess.run(["node", str(root / "scripts/e2e-demo-db.mjs"), *args], text=True, capture_output=True, env=env or os.environ.copy())
    line = (r.stdout.strip().splitlines() or ["{}"])[-1]
    try:
        out = json.loads(line)
    except json.JSONDecodeError:
        out = {"ok": False, "error": (r.stderr or r.stdout)[-800:]}
    if r.returncode != 0 or not out.get("ok"):
        raise RuntimeError(f"e2e-demo-db {args[0]}: {out.get('error') or r.stderr[-800:]}")
    return out


# ---------- What the numbers must be ----------

# The demo's story (docs/DEMO_SCRIPT.md, README "The demo lease"): the figures a judge sees, written down here as the
# oracle the code's own figures are held to. The deductions are also worked out again below from their stored inputs.
DEMO = {
    "rent": 2400.0, "deposit": 4800.0, "lease_total": 5100.0, "over_cap": 300.0, "late_fee": 120.0,
    "carpet": 720.0, "wall": 140.0, "range": 150.0, "deductions": 1010.0, "refund": 3790.0,
}
MONEY = re.compile(r"\$([0-9][0-9,]*\.[0-9]{2})")


def amounts(text):
    return sorted({cents(m.replace(",", "")) for m in MONEY.findall(text)})


def doc_beats():
    """The numbered beats of docs/DEMO_SCRIPT.md's beat table: each one's number and its title. The motion table's rows
    don't start with a bare number, so they are skipped."""
    out = []
    for line in (REPO / "docs/DEMO_SCRIPT.md").read_text().splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 5 or not re.fullmatch(r"\d+", cells[0]):
            continue
        out.append((int(cells[0]), cells[2]))
    return out


def guide_beats():
    """The same beats as src/lib/demo-guide.ts carries them for the guide inside a demo copy."""
    src = (REPO / "src/lib/demo-guide.ts").read_text()
    return [(int(n), t) for n, t in re.findall(r"\{\s*n:\s*(\d+),\s*title:\s*\"([^\"]+)\"", src)]


def doc_beat_rows():
    """Each numbered beat's whole row of docs/DEMO_SCRIPT.md's beat table, by number: where the property that beat runs
    on is named."""
    out = {}
    for line in (REPO / "docs/DEMO_SCRIPT.md").read_text().splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 5 or not re.fullmatch(r"\d+", cells[0]):
            continue
        out[int(cells[0])] = " | ".join(cells)
    return out


def guide_units():
    """The property each beat names in src/lib/demo-guide.ts (BEATS, `unit`): the unit that beat runs on in a copy."""
    src = (REPO / "src/lib/demo-guide.ts").read_text()
    return {int(n): u for n, u in re.findall(r"\{\s*n:\s*(\d+),.*?unit:\s*\"([^\"]+)\"", src)}


def window_days():
    """PayPal's refund window as src/lib/refund-rail.ts holds it: the one number the review's rail line may use, so it
    is read from there rather than typed here."""
    m = re.search(r"REFUND_WINDOW_DAYS = (\d+)", (REPO / "src/lib/refund-rail.ts").read_text())
    return int(m.group(1))


def days_since_paid(facts, mo):
    """How many days ago the copy's deposit was paid, counted as src/lib/closeout.ts counts it: the payment's day where
    the property is (Pacific), as PayPal dates it (dates.ts, paypalPaidAt), against today there."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    pacific = ZoneInfo("America/Los_Angeles")
    txn = next(p for p in facts["payments"] if p["tenancy_id"] == mo and p["kind"] == "deposit_invoice")["raw"]["transactions"][0]
    ts, day = txn.get("payment_date_time"), txn.get("payment_date")
    if ts and day and ts[:10] == day:
        paid = datetime.fromisoformat(day).date()
    else:
        paid = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(pacific).date()
    return (datetime.now(pacific).date() - paid).days


def paid_ago(n):
    """closeout.ts, paidAgo: today, yesterday, or so many days ago."""
    return "today" if n <= 0 else "yesterday" if n == 1 else f"{n} day{'' if n == 1 else 's'} ago"


def money_words(amount):
    """An amount as PayPal writes it in its own record: "3790.00 USD"."""
    return f"{amount:.2f} USD"


def record_want_refund(row, capture):
    """PayPal's record of a refund as the screen must list it, from the fake PayPal's own answer when the refund was made
    (the payments row's raw holds that answer verbatim, and the fake's read of the refund returns the same)."""
    raw = row["raw"]
    return {"PayPal's refund ID": row["paypal_id"], "PayPal's status": raw["status"], "PayPal's amount": f"{raw['amount']['value']} {raw['amount']['currency_code']}",
            "PayPal's create time": raw["create_time"], "PayPal's update time": raw["update_time"], "PayPal's payment refunded": capture}


def recompute(d):
    """A deduction's amount from its stored inputs, worked out here independently of src/lib/deductions.ts: the
    vendor's invoice, the landlord's hours times the rate, and a replacement prorated over its useful life."""
    billed = float(d["billed"] or 0)
    if d["proration"] == "useful_life" and d["useful_life_years"]:
        life, age = float(d["useful_life_years"]), float(d["item_age_years"] or 0)
        return cents(billed * max(0.0, life - age) / life)
    if d["performer"] == "own_labor" and d["hours"] is not None:
        return cents(float(d["hours"]) * float(d["hourly_rate"] or 0))
    return cents(billed)


def expected(facts, units):
    """Every figure the walk checks, from the copy's own rows and the demo's story, never from the app's pages."""
    pays = facts["payments"]
    by_t = lambda rows, t: [r for r in rows if r["tenancy_id"] == t]
    mo = units["move_out"]
    ded = by_t(facts["deductions"], mo)
    named = {k: next((d for d in ded if re.search(p, d["item"], re.I)), None) for k, p in (("carpet", "carpet"), ("wall", "wall"), ("range", "range"))}
    deposit = cents(next(p["amount"] for p in by_t(pays, mo) if p["kind"] == "deposit_invoice"))
    e = {"deposit": deposit, **{k: recompute(d) if d else None for k, d in named.items()}, "stored": {k: cents(d["amount"]) if d else None for k, d in named.items()}}
    e["deductions"] = cents(sum(recompute(d) for d in ded))
    e["refund"] = cents(deposit - e["deductions"])
    # The tenants dispute the carpet. Their advocate (the stub) asks for half of it back inside its lawful range; the
    # landlord's negotiator answers with a third of the gap, the advocate with the middle rounded down to $50, and the
    # negotiator meets it (src/lib/e2e-stubs.ts).
    carpet = e["carpet"]
    e["case_keep"] = cents(round(carpet / 2))
    e["case_back"] = cents(carpet - e["case_keep"])
    l1 = cents(round((carpet - (carpet - e["case_keep"]) / 3) / 10) * 10)
    t1 = cents((int((e["case_keep"] + l1) / 2) // 50) * 50)
    e["turns_back"] = [cents(carpet - l1), cents(carpet - t1), cents(carpet - t1)]
    e["settled"] = e["turns_back"][-1]
    e["settled_keep"] = t1
    e["returned"] = cents(e["refund"] + e["settled"])
    e["kept"] = cents(e["deductions"] - e["settled"])
    # The whole copy, as the README defines the ledger's figures: collected, returned (refunds and settlements),
    # kept (deductions as settled, once the statement went out), and still held (each tenancy clamped at zero).
    port = {"collected": 0.0, "returned": 0.0, "settled": 0.0, "kept": 0.0, "held": 0.0}
    by_state = {}
    for t in facts["tenancies"]:
        st = by_state.setdefault((t.get("properties") or {}).get("state") or "CA", {"collected": 0.0, "returned": 0.0, "settled": 0.0, "kept": 0.0, "held": 0.0})
        tp = by_t(pays, t["id"])
        got = sum(float(p["amount"]) for p in tp if p["kind"] == "deposit_invoice")
        back = sum(float(p["amount"]) for p in tp if p["kind"] in ("refund", "payout", "settlement_refund", "settlement_payout", "dispute_refund") and p["status"] not in ("FAILED", "CANCELLED", "DENIED", "RETURNED", "REVERSED"))
        settled = sum(float(p["amount"]) for p in tp if p["kind"] in ("settlement_refund", "settlement_payout"))
        kept = cents(sum(float(d["amount"]) for d in by_t(facts["deductions"], t["id"])) - settled) if t["statement_delivered_at"] else 0.0
        for acc in (port, st):
            acc["collected"] += got
            acc["returned"] += back
            acc["settled"] += settled
            acc["kept"] += kept
            acc["held"] += max(0.0, cents(got - kept - back))
    e["portfolio"] = {k: cents(v) for k, v in port.items()}
    e["by_state"] = {s: {k: cents(v) for k, v in acc.items()} for s, acc in by_state.items()}
    return e


# ---------- The walk ----------

def walk(base, setup, shots, check, facts):
    from playwright.sync_api import sync_playwright

    U = setup["units"]
    mo, closed, tx = U["move_out"], U["closed"], U["notice"]
    n = [0]

    def shot(page, name):
        n[0] += 1
        # From the top, so the sticky bars sit where a reader sees them in the full-page picture.
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(300)
        page.screenshot(path=str(shots / f"{n[0]:02d}-{name}.png"), full_page=True)

    def text(page):
        """The page's words as a reader sees them, every run of white space one space."""
        return re.sub(r"\s+", " ", page.evaluate("() => (document.querySelector('main') || document.body).innerText")).strip()

    def sees(step, page, *wanted):
        t = text(page)
        wanted = tuple(w if isinstance(w, re.Pattern) else re.sub(r"\s+", " ", w) for w in wanted)
        missing = [w for w in wanted if (w.search(t) is None if isinstance(w, re.Pattern) else w not in t)]
        check(f"{step}: shows {', '.join(w.pattern if isinstance(w, re.Pattern) else repr(w) for w in wanted)}", not missing,
              f"missing {missing}; the page reads: {t[:600]!r}")
        return t

    def guide(page):
        """The demo guide as the page shows it: {beat number: ("done" | "now" | "todo", where it links)}."""
        return {int(k): tuple(v) for k, v in page.evaluate("""() => Object.fromEntries(
          [...document.querySelectorAll('[data-guide-step]')].map((li) => [li.dataset.guideStep,
            [li.dataset.guideState, li.querySelector('a') ? new URL(li.querySelector('a').href).pathname + new URL(li.querySelector('a').href).search + new URL(li.querySelector('a').href).hash : null]]))""").items()}

    def only_amounts(step, t, allowed):
        """Every dollar figure on the screen is one the code computes for it: a wrong total can't hide in a corner."""
        stray = [a for a in amounts(t) if not any(abs(a - x) < 0.005 for x in allowed)]
        check(f"{step}: every dollar figure on the screen is one of the computed figures", not stray, f"unexpected {[usd(a) for a in stray]}")

    def go(page, path):
        page.goto(base + path, wait_until="networkidle")
        page.wait_for_timeout(250)

    # "PayPal's record" (components/paypal-record.tsx): a collapsed section that reads PayPal (here the fake) when it is
    # opened and lists the fields PayPal returned, each labelled as PayPal's. `scope` is the page or the row's dialog.
    def record_rows(scope):
        det = scope.locator("details", has_text="PayPal's record").first
        return dict(det.evaluate("d => [...d.querySelectorAll('dl > div')].map((x) => [x.querySelector('dt').innerText.trim(), x.querySelector('dd').innerText.trim()])"))

    def open_record(scope):
        scope.locator("summary", has_text="PayPal's record").first.click()
        scope.get_by_text("Read from PayPal just now", exact=True).first.wait_for(timeout=30_000)
        return record_rows(scope)

    def ledger_record(view, has, name):
        """A row's details on the Payments ledger (the view, the row by its words), its PayPal's record opened and read,
        a screenshot, and the panel closed."""
        go(page, f"/ledger?view={view}")
        page.locator(".ag-row").first.wait_for()
        row = page.locator(".ag-row[row-index]", has_text=has).first
        row.locator(".ag-cell[col-id='date']").click()
        dlg = page.get_by_role("dialog")
        dlg.wait_for(timeout=10_000)
        rec = open_record(dlg)
        shot(page, name)
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        return rec

    # The two windows side by side (beats 6 and 7): a page left open shows what the other side did without a reload.
    # `stay` marks the page (a reload or a navigation would drop the mark); `arrives` waits for the change and says
    # whether the page is still the same one; `asks` counts what the page requested since a moment (its status route,
    # and the refreshes of itself it made).
    WATCH_S = 25

    def stay(page):
        page.evaluate("() => { window.__gfStay = true; }")

    def arrives(page, shown):
        until = time.time() + WATCH_S
        while time.time() < until:
            try:
                if shown():
                    return bool(page.evaluate("() => window.__gfStay === true"))
            except Exception:
                pass
            page.wait_for_timeout(250)
        return False

    def asks(log, since, own=""):
        mine = [u for t, u in log if t >= since]
        return (sum(1 for u in mine if u.split("?")[0].endswith("/dispute") and "/api/" in u),
                sum(1 for u in mine if "_rsc=" in u and u.split("?")[0].endswith(own)))

    # A button that acts and then refreshes the page (Send refund, Let my negotiator answer, Accept settlement, Approve
    # and pay) stays busy, "Sending..." or disabled, until the refreshed page is in. Cleared as soon as the request
    # answered, it came back on with its old label for the half second the refresh took, and the old screen showed
    # again with it. `watch_button` records every change to the button from before the click (the first button whose
    # words match `rest`, outside the confirm dialog, which has a button of the same name), one frame per change, so
    # a frame can't slip between two looks; `no_flash` reads them once the new screen is up and fails on a frame after
    # the first busy one with the old label on a live button.
    WATCH = """(rest) => {
      const R = new RegExp(rest);
      const t0 = performance.now();
      window.__gfFrames = [];
      const look = () => {
        const b = [...document.querySelectorAll('button')].find((x) => !x.closest('[role=alertdialog]') && R.test(x.textContent.trim()));
        const f = b ? { t: Math.round(performance.now() - t0), label: b.textContent.trim(), on: !b.disabled } : { t: Math.round(performance.now() - t0), gone: true };
        const last = window.__gfFrames[window.__gfFrames.length - 1];
        if (!last || last.label !== f.label || last.on !== f.on || last.gone !== f.gone) window.__gfFrames.push(f);
      };
      const obs = new MutationObserver(look);
      obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      window.__gfFramesStop = () => obs.disconnect();
      look();
    }"""

    def watch_button(page, rest):
        page.evaluate(WATCH, rest)

    def no_flash(step, page, rest):
        frames = page.evaluate("() => { if (window.__gfFramesStop) window.__gfFramesStop(); return window.__gfFrames || []; }")
        R = re.compile(rest)
        # Busy: disabled, "...ing", or gone (Let my negotiator answer leaves with its block while the agents run).
        busy = next((i for i, f in enumerate(frames) if i > 0 and (f.get("gone") or not f["on"] or f["label"].endswith("..."))), None)
        back = [f for f in frames[busy + 1:] if not f.get("gone") and f["on"] and R.search(f["label"])] if busy is not None else []
        how = "no busy frame" if busy is None else f"back on {back[0]['t'] - frames[busy]['t']} ms after it went busy" if back else "stayed busy"
        check(f"{step}: the button stays busy until the refreshed page is in, never back on with its old label", busy is not None and not back,
              f"{how}; the frames since the click: {json.dumps(frames)[:700]}")

    f0 = facts()
    E = expected(f0, U)

    # 0. The figures, before anything is clicked: the code's stored amounts against the inputs and the demo's story.
    for k in ("carpet", "wall", "range"):
        check(f"deductions: the {k}'s stored amount is its inputs worked out again ({usd(E[k] or 0)})", E[k] is not None and abs(E["stored"][k] - E[k]) < 0.005,
              f"stored {E['stored'][k]}, inputs give {E[k]}")
        check(f"deductions: the {k} is the demo's {usd(DEMO[k])}", E[k] is not None and abs(E[k] - DEMO[k]) < 0.005, f"{E[k]}")
    check(f"deductions: {usd(E['deductions'])} in all, the demo's {usd(DEMO['deductions'])}; refund {usd(E['refund'])}, the demo's {usd(DEMO['refund'])}",
          abs(E["deductions"] - DEMO["deductions"]) < 0.005 and abs(E["refund"] - DEMO["refund"]) < 0.005 and abs(E["deposit"] - DEMO["deposit"]) < 0.005,
          json.dumps({k: E[k] for k in ("deposit", "deductions", "refund")}))
    # The demo guide's eight steps are docs/DEMO_SCRIPT.md's eight beats: the same numbers and titles, in its order
    # (src/lib/demo-guide.ts). Checked here, so a beat renamed or reordered in one file fails until it moves in both.
    beats, guided = doc_beats(), guide_beats()
    check(f"demo guide: the demo script has eight numbered beats ({len(beats)} found)", len(beats) == 8, json.dumps(beats))
    check("demo guide: its steps are those beats, by number and title, in that order", beats == guided,
          f"the demo script has {json.dumps(beats)}, the guide {json.dumps(guided)}")
    # The guide picks the unit a beat runs on by the address that beat's own row names, so nothing a judge does in the
    # copy can move it (liveUnit, src/lib/demo-guide.ts). Those addresses have to stay the same in both files.
    units_named, rows = guide_units(), doc_beat_rows()
    astray = {n: u for n, u in units_named.items() if u not in rows.get(n, "")}
    check("demo guide: the live unit and the second state's unit are the ones their own beats name in the demo script",
          2 in units_named and 8 in units_named and not astray, f"the guide names {json.dumps(units_named)}; astray {json.dumps(astray)}")

    D, R, P = usd(E["deposit"]), usd(E["refund"]), usd(E["deductions"])
    line_amounts = [E["carpet"], E["wall"], E["range"]]

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        ctx.add_cookies([{"name": setup["cookie"]["name"], "value": setup["cookie"]["value"], "url": base}])
        page = ctx.new_page()
        errors = []
        asked_l, asked_t = [], []  # every GET each side's page made, with its moment (the side-by-side checks)
        page.on("request", lambda r: asked_l.append((time.time(), r.url)) if r.method == "GET" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text[:200]}") if m.type == "error" else None)
        page.set_default_timeout(30_000)

        # 0. The welcome (components/demo-welcome.tsx): a browser that hasn't seen it meets the card on Properties, in
        # words read off the copy's own units; its tour rings the live unit, the next steps, the Texas unit and the
        # guide, in that order, each ring around its own part of the page; its last button opens the move-out photos;
        # the browser then keeps "seen", so Properties opens without it, and Welcome tour in the account menu opens it
        # again.
        go(page, "/units")
        card = page.locator("[data-welcome]")
        dep = f"${E['deposit']:,.0f}" if abs(E["deposit"] - round(E["deposit"])) < 0.005 else usd(E["deposit"])
        words = re.sub(r"\s+", " ", card.inner_text()) if card.count() else ""
        want = ["You're the landlord at Harbor View Rentals",
                f"Luke Jones and Lane Forti moved out of 1140 E. Juniper Hollow Ln. Close out their {dep} deposit. California gives you 21 days.",
                "PayPal runs in its sandbox", "8 steps, ticked off in the checklist"]
        check("Welcome: the card opens on Properties, with the copy's own tenants, unit, deposit and clock",
              card.count() == 1 and all(w.lower() in words.lower() for w in want), f"wanted {want}; the card reads {words[:500]!r}")
        shot(page, "welcome")
        page.get_by_role("button", name="Show me around").click()
        RING = """(sel) => {
          const part = [...document.querySelectorAll(sel)].find((e) => e.checkVisibility());
          const ring = document.querySelector('[data-tour-ring]');
          if (!part || !ring) return null;
          const a = part.getBoundingClientRect(), b = ring.getBoundingClientRect();
          return { around: b.left <= a.left + 1 && b.top <= a.top + 1 && b.right >= Math.min(a.right, innerWidth) - 1 && b.bottom >= a.bottom - 1
                     && b.width - a.width < 24 && b.height - a.height < 24,
                   seen: b.top >= 0 && b.top < innerHeight };
        }"""
        stops = []
        for anchor in (f'[data-tour-unit="{mo}"]', '[data-tour="next-steps"]', f'[data-tour-unit="{tx}"]', '[data-tour="guide"]'):
            page.locator("[data-tour-stop]").wait_for()
            page.wait_for_timeout(300)
            pop = page.locator("[data-tour-stop]")
            stops.append({"stop": pop.get_attribute("data-tour-stop"), "title": pop.locator("h2").inner_text(),
                          "count": pop.inner_text().split("\n")[0], "ring": page.evaluate(RING, anchor)})
            shot(page, f"tour-{len(stops)}")
            if len(stops) == 1:
                # A unit is a table row on a computer and a card on a phone: a window that crosses between the two (a
                # tablet turned, a window resized) moves the ring to the part now on screen, and back.
                page.set_viewport_size({"width": 390, "height": 844})
                page.wait_for_timeout(400)
                narrow = page.evaluate(RING, anchor)
                page.screenshot(path=str(shots / "tour-1-phone.png"))  # the screen as it is, not shot()'s full page from the top
                page.set_viewport_size({"width": 1440, "height": 1000})
                page.wait_for_timeout(400)
                wide = page.evaluate(RING, anchor)
                check("Welcome tour: a window that crosses to phone width and back keeps the ring on the unit, card then row",
                      bool(narrow and narrow["around"] and narrow["seen"] and wide and wide["around"] and wide["seen"]),
                      json.dumps({"phone": narrow, "wide": wide}))
            if len(stops) < 4:
                pop.get_by_role("button", name="Next").click()
        check("Welcome tour: four stops, in order, each ringing its own part of Properties on screen",
              [s["title"] for s in stops] == ["Your move-out", "What the law needs next", "A second state", "Your 8 steps"]
              and [s["count"] for s in stops] == ["1 of 4", "2 of 4", "3 of 4", "4 of 4"]
              and all(s["ring"] and s["ring"]["around"] and s["ring"]["seen"] for s in stops), json.dumps(stops))
        page.get_by_role("link", name="Start with the move-out").click()
        page.wait_for_url(re.compile(rf"/tenancy/{mo}\?tab=move-out#photos$"))
        seen = [c["value"] for c in ctx.cookies(base) if c["name"] == "gf_welcome"]
        check("Welcome tour: its last button opens the move-out photos, and the browser keeps that it has seen the welcome",
              seen == ["seen"], f"the cookie: {seen}")
        # The refund review has its own layout, and Back from it brings the landlord pages back from the browser's
        # history as they were first drawn, before the welcome was seen: Properties still opens without it.
        page.evaluate(f"() => document.querySelector('a[href=\"/tenancy/{mo}/refund\"]').click()")
        page.wait_for_url(re.compile(rf"/tenancy/{mo}/refund$"))
        page.go_back()
        page.wait_for_url(re.compile(rf"/tenancy/{mo}\?tab=move-out"))
        page.wait_for_timeout(300)
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Properties").click()
        page.wait_for_url(re.compile(r"/units$"))
        page.wait_for_timeout(800)
        check("Welcome: back from the refund review, Properties still opens without it", page.locator("[data-welcome]").count() == 0)
        go(page, "/units")
        check("Welcome: seen once, Properties opens without it", page.locator("[data-welcome]").count() == 0)
        page.locator("header").get_by_role("button", name="Account", exact=True).first.click()
        page.get_by_role("button", name="Welcome tour").click()
        page.locator("[data-welcome]").wait_for()
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        check("Welcome: Welcome tour in the account menu opens it again, and Escape closes it", page.locator("[data-welcome]").count() == 0)
        # A page change under the tour (Back, a swipe, a link pressed past it) ends it: Properties, opened again, has
        # no tour and no locked page.
        page.locator("header").get_by_role("button", name="Account", exact=True).first.click()
        page.get_by_role("button", name="Welcome tour").click()
        page.get_by_role("button", name="Show me around").click()
        page.locator("[data-tour-stop]").wait_for()
        page.evaluate("() => document.querySelector('aside a[href=\"/move-outs\"]').click()")
        page.wait_for_url(re.compile(r"/move-outs$"))
        page.evaluate("() => document.querySelector('aside a[href=\"/units\"]').click()")
        page.wait_for_url(re.compile(r"/units$"))
        page.wait_for_timeout(2500)
        left = {"stop": page.locator("[data-tour-stop]").count(), "card": page.locator("[data-welcome]").count(),
                "overflow": page.evaluate("() => getComputedStyle(document.body).overflow")}
        check("Welcome tour: a page change under it ends it, and Properties opens again without it",
              left == {"stop": 0, "card": 0, "overflow": "visible"}, json.dumps(left))

        # 1. Properties (and beat 8: the Texas unit under its own rules).
        go(page, "/units")
        t = sees("Properties", page, "Properties", "1140 E. Juniper Hollow Ln", "482 N. Glassell St, Unit B", "2317 Mesquite Bend Dr, Unit 3",
                 "Move-out review", "Notice given", "Closed")
        check("Properties: the account is the demo landlord's, Harbor View Rentals", "Harbor View Rentals" in page.inner_text("body"))
        # Before the refund: the move-out unit's deposit and the Texas one (the closed unit's went back).
        sees("Properties: deposits held", page, f"Deposits held\n{usd(E['portfolio']['held'])}")
        shot(page, "properties")

        # 1b. The demo guide (components/demo-guide.tsx): the eight beats above every page of a judge's own copy, each
        # a link into this copy, each ticked off by the copy's own rows. Before the close-out, what the copy was made
        # with is ticked (the lease Claude read, the paid deposit, the photo comparison, the unit in the second state)
        # and the live part, from the refund on, is not.
        g = guide(page)
        check("Demo guide: the eight beats are listed in order", sorted(g) == [1, 2, 3, 4, 5, 6, 7, 8], f"{sorted(g)}")
        check("Demo guide: before the close-out, four beats are ticked off the copy's own rows and the refund is next",
              [g[i][0] for i in range(1, 9)] == ["done", "done", "done", "now", "todo", "todo", "todo", "done"],
              json.dumps({k: v[0] for k, v in sorted(g.items())}))
        sees("Demo guide", page, "Demo guide", "4 of 8 done", "1. Lease check", "4. Refund approval", "8. Multi-state",
             "Claude boxes what changed between the photos.")
        want = {1: "/lease", 2: f"/tenancy/{mo}#move-in", 3: f"/tenancy/{mo}?tab=move-out#photos", 4: f"/tenancy/{mo}/refund",
                5: f"/tenancy/{mo}/statement#delivery", 6: f"/tenancy/{mo}?tab=move-out#negotiation",
                7: f"/tenancy/{mo}?tab=move-out#negotiation", 8: f"/tenancy/{tx}"}
        wrong = {k: g[k][1] for k in want if g[k][1] != want[k]}
        check("Demo guide: every step opens that beat's own page and card in this copy", not wrong, f"wanted {json.dumps(want)}, got {json.dumps(wrong)}")

        go(page, f"/tenancy/{tx}")
        sees("Texas unit", page, "Rules: Tex. Prop. Code ch. 92", "Austin, TX 78745", "Notice given")
        page.get_by_role("button", name=re.compile(r"^Rules: Tex\. Prop\. Code")).first.hover()
        page.wait_for_timeout(300)
        tip = " ".join(page.locator("[role=tooltip]").all_inner_texts())
        check("Texas unit: the Rules chip's tip names the Texas statute and its bad-faith penalty", "92" in tip and "$100" in tip, tip[:300])
        shot(page, "texas-rules")

        # 2. Check a lease (beat 1). First the sample in one click, from the facts Claude read when the demo was built
        # (no Claude call: the server-log check at the end counts the lease stub's answers), then the stubbed live read
        # of demo/lease-single-owner.pdf, judged by the code.
        go(page, "/lease")
        check("Sample lease: the PDF itself opens from the link beside the button",
              page.get_by_role("link", name="open it").get_attribute("href") == "/api/lease/sample")
        page.get_by_role("button", name="Check the sample lease").click()
        page.get_by_role("heading", name="Findings").wait_for(timeout=30_000)
        sees("Sample lease", page, "lease-single-owner.pdf", "1140 E. Juniper Hollow Ln, Orange, CA 92867", "Sample", "Checked",
             "The sample lease, from the facts Claude read when the demo was built", f"Lawful deposit\n{usd(DEMO['deposit'])}",
             f"Lease asks {usd(DEMO['over_cap'])} more", "3 violations", "1 warning")
        shot(page, "sample-lease")
        # The sample has no daily allowance, so it must not add a file to the shared storage on every click: checking it
        # again reuses the workspace's one stored copy.
        paths = page.evaluate("""async () => { const p = []; for (let i = 0; i < 2; i++)
          p.push((await (await fetch("/api/lease/sample", { method: "POST" })).json()).leasePath); return p; }""")
        check("Sample lease: checking it again reuses the workspace's one stored copy", paths[0] is not None and paths[0] == paths[1],
              f"leasePath {paths}")
        go(page, "/lease")
        page.locator("input[type=file]").set_input_files(str(REPO / "demo/lease-single-owner.pdf"))
        page.get_by_role("heading", name="Findings").wait_for(timeout=60_000)
        t = sees("Lease check", page, "lease-single-owner.pdf", "1140 E. Juniper Hollow Ln, Orange, CA 92867", "Checked",
                 f"Security in the lease\n{usd(DEMO['lease_total'])}", f"Deposit cap\n{usd(DEMO['deposit'])}", "Two months' rent",
                 f"Lawful deposit\n{usd(DEMO['deposit'])}", f"Lease asks {usd(DEMO['over_cap'])} more",
                 "Security over the two-month cap", '"Nonrefundable" security', "Mandatory professional cleaning", "Late fee needs to be a reasonable estimate",
                 "3 violations", "1 warning", f"a PayPal invoice for {usd(DEMO['deposit'])}, the lawful amount")
        state = page.get_by_label("State the property is in")
        check("Lease check: the State picker is shown, on California", state.count() == 1 and state.input_value() == "CA")
        only_amounts("Lease check", t, [DEMO["lease_total"], DEMO["deposit"], DEMO["over_cap"], DEMO["rent"], 300.0])
        shot(page, "lease-check")

        # 3. The move-out unit's Overview (beat 2): the deposit through a PayPal invoice, the signed refund agreement.
        go(page, f"/tenancy/{mo}")
        t = sees("Overview", page, "1140 E. Juniper Hollow Ln", "Move-out review", "Rules: Civ. Code 1950.5", f"Deposit held\n{D}", f"Rent\n{usd(DEMO['rent'])}",
                 "Refund agreement", "PayPal to e2e-tenant@example.com", "Deposit through PayPal", setup["pool"]["invoice"], "Paid")
        only_amounts("Overview", t, [E["deposit"], DEMO["rent"]])
        shot(page, "overview")

        # 4. Move-out (beat 3): the photo pairs with Claude's boxes, and the deductions computed in code.
        # The tab, clicked as a judge does (it switches in the browser, no request).
        page.get_by_role("link", name="Move-out", exact=True).first.click()
        page.get_by_text("Photo comparison").first.wait_for()
        page.wait_for_load_state("networkidle")
        t = sees("Move-out", page, f"Deposit held\n{D}", f"Deductions\n{P}", f"Refund due\n{R}", "Large carpet stain, center", "Three small wall holes",
                 "Wear and tear", "Wall hole with cracks", "Grease spots on range", "Prorated, 4 of 10 years left", f"{R} to Luke Jones and Lane Forti",
                 "Nothing moves until you approve it.")
        boxes = page.locator(".gf-mark")
        titles = boxes.evaluate_all("els => els.map(e => e.getAttribute('title'))")
        check("Move-out: Claude's damage boxes are drawn on the move-out photos", len(titles) >= 4 and any("carpet stain" in (x or "") for x in titles), json.dumps(titles))
        outs = page.locator("img[data-out]")
        for i in range(outs.count()):
            outs.nth(i).scroll_into_view_if_needed()
        page.wait_for_function("() => { const xs = [...document.querySelectorAll('img[data-out]')]; return xs.length >= 3 && xs.every(i => i.complete && i.naturalWidth > 0); }", timeout=30_000)
        check("Move-out: the three rooms' move-out photos load", outs.count() >= 3, f"{outs.count()} photos")
        carpet_box = page.locator(".gf-mark[title*='carpet stain']").first
        carpet_box.scroll_into_view_if_needed()
        carpet_box.hover()
        grid = page.locator(".gf-deductions .ag-row").evaluate_all("rs => rs.map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
        gtext = " | ".join(grid)
        check("Move-out: the deductions grid has each charge at its computed amount, wear and tear at $0.00",
              all(usd(a) in gtext for a in line_amounts) and "Not deductible" in gtext and "$0.00" in gtext, gtext[:500])
        only_amounts("Move-out", t, [E["deposit"], E["deductions"], E["refund"], *line_amounts, 0.0, 1800.0, 50.0])
        shot(page, "move-out")

        # 5. Review refund (beat 4): the agent's plan and steps, the approval, PayPal's (fake) refund.
        go(page, f"/tenancy/{mo}/refund")
        sees("Review refund", page, "Review refund", R, f"{D} deposit less {P} in deductions", "PayPal refund to the original payment", "Prepare refund")
        # The rail in words beside Method: how long ago PayPal says the deposit was paid (the fake deposit, three days
        # ago), and PayPal's window from refund-rail.ts, never typed into the test.
        W = window_days()
        sees("Review refund: the rail decision in words, with the window from refund-rail.ts", page,
             f"Original payment, paid {paid_ago(days_since_paid(f0, mo))}, inside PayPal's {W}-day refund window. After day {W} this goes as a Payout to the account the tenants named in writing.")
        page.get_by_role("button", name="Prepare refund").click()
        page.get_by_role("button", name="Send refund").wait_for(timeout=90_000)
        t = sees("Refund prepared", page, "This refund will be sent today through PayPal.", "Done by the agent", "Read the lease and the move-out file",
                 f"Verified the {D} deposit with PayPal", f"Prepared the {R} refund", "Waiting for your approval", "Final check before sending", "Matches the file")
        only_amounts("Refund prepared", t, [E["refund"], E["deposit"], E["deductions"]])
        shot(page, "refund-prepared")
        # The prepared review opened again, as from Move-out: while PayPal's part streams in behind its skeletons, Send
        # refund and Decline stay off (the waiting buttons have no run id); once it is in, both are on. Every DOM change
        # on the way is recorded, so a frame with a skeleton and a live button can't slip between two looks.
        page.add_init_script("""
          if (location.pathname.endsWith('/refund')) {
            window.__gfButtons = [];
            const look = () => {
              const bs = [...document.querySelectorAll('main button')];
              const by = (w) => bs.find((b) => b.textContent.trim() === w);
              const send = by('Send refund'), decline = by('Decline');
              if (!send && !decline) return;
              window.__gfButtons.push({ sk: !!document.querySelector('main [data-skeleton]'), send: !!send && !send.disabled, decline: !!decline && !decline.disabled });
            };
            new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true });
          }
        """)
        go(page, f"/tenancy/{mo}/refund")
        page.get_by_text("Matches the file").first.wait_for(timeout=30_000)
        frames = page.evaluate("() => window.__gfButtons || []")
        early = [x for x in frames if x["sk"] and (x["send"] or x["decline"])]
        print(f"  the prepared review's buttons, looked at {len(frames)} times, {sum(1 for x in frames if x['sk'])} of them with a skeleton up", flush=True)
        check("Refund prepared, opened again: Send refund and Decline stay off while the review waits for PayPal", not early,
              f"{len(frames)} looks, {sum(1 for x in frames if x['sk'])} with a skeleton up, {len(early)} with a button on: {json.dumps(early[:3])}")
        check("Refund prepared, opened again: Send refund and Decline are on once PayPal has answered",
              page.get_by_role("button", name="Send refund").is_enabled() and page.get_by_role("button", name="Decline").is_enabled()
              and page.locator("main [data-skeleton]").count() == 0)
        watch_button(page, r"^Send refund$|^Sending\.\.\.$")
        page.get_by_role("button", name="Send refund").click()
        page.get_by_text("Sent through PayPal").first.wait_for(timeout=90_000)
        no_flash("Send refund", page, r"^Send refund$")
        f1 = facts()
        refunds = [p for p in f1["payments"] if p["tenancy_id"] == mo and p["kind"] == "refund"]
        rid = refunds[0]["paypal_id"] if refunds else ""
        check(f"Refund: one refund recorded, {R}, completed, with the fake PayPal's id", len(refunds) == 1 and abs(float(refunds[0]["amount"]) - E["refund"]) < 0.005
              and refunds[0]["status"] == "COMPLETED" and rid.startswith("E2E"), json.dumps(refunds)[:400])
        t = sees("Refund sent", page, "Refund sent", R, "Prepared by the agent", "Approved by you", "Sent through PayPal", rid, "Completed")
        only_amounts("Refund sent", t, [E["refund"]])
        # PayPal's record under the receipt: opened, it reads the refund back from the fake PayPal through the app's
        # paypal-record route, and every field it lists is the one the fake returned (the row's raw holds that answer):
        # PayPal's id, status, amount, times, and the capture it refunded, which is the copy's fake deposit.
        rec = open_record(page)
        want = record_want_refund(refunds[0], setup["pool"]["capture"]) if refunds else {}
        check("Refund sent: PayPal's record lists the refund's fields as the fake PayPal returned them, a completed refund of the copy's own deposit",
              rec == want and want.get("PayPal's status") == "COMPLETED" and want.get("PayPal's amount") == money_words(E["refund"]),
              f"shown {json.dumps(rec)}, the fake returned {json.dumps(want)}")
        # Check again asks the route again and shows the same record.
        since = time.time()
        page.get_by_role("button", name="Check again").click()
        asked_again = []
        until = time.time() + 10
        while time.time() < until:
            asked_again = [u for ts, u in asked_l if ts >= since and "/paypal-record?" in u]
            if asked_again and page.get_by_text("Read from PayPal just now", exact=True).count() == 1:
                break
            page.wait_for_timeout(200)
        check("Refund sent: Check again reads PayPal again and shows the same record", len(asked_again) >= 1 and record_rows(page) == want,
              f"{len(asked_again)} reads since the click; shown {json.dumps(record_rows(page))}")
        shot(page, "refund-sent")

        # 6. The itemized statement, its delivery, and the tenants' page.
        go(page, f"/tenancy/{mo}/statement")
        t = sees("Statement", page, "Itemized statement", f"Security held\n{D}", f"Deductions\n{P}", f"Refunded\n{R}", "The lease asked for $5,100.00; the cap is $4,800.00",
                 *[usd(a) for a in line_amounts], "$1,800.00 × 4 years left of a 10-year useful life (6 years old) = $720.00", "3 hours × $50.00/hour = $150.00", rid,
                 "Required: repair and cleaning total $1,010.00, over $125.00")
        only_amounts("Statement", t, [E["deposit"], E["deductions"], E["refund"], DEMO["lease_total"], *line_amounts, 1800.0, 50.0, 125.0])
        page.get_by_role("button", name="Record delivery").first.click()
        page.get_by_role("dialog").get_by_role("button", name="In person").click()
        page.get_by_role("dialog").get_by_role("button", name="Record delivery").click()
        page.get_by_text("Open the tenant's view").first.wait_for(timeout=30_000)
        sees("Statement delivered", page, "Delivered", "In person")
        link = page.get_by_role("link", name=re.compile("Open the tenant's view")).first
        href = link.get_attribute("href")
        check("Statement: Open the tenant's view opens this copy's tenants' page in a new tab", href == setup["tenantPath"] and link.get_attribute("target") == "_blank", f"{href} {link.get_attribute('target')}")
        # The guide ticks itself off the copy's rows: the refund it pointed at is done, and the tenant-dispute step now
        # opens the card that opens the tenants' page, where before the delivery it opened the delivery card.
        g = guide(page)
        check("Demo guide: the refund step is ticked once the refund is sent", g[4][0] == "done", json.dumps({k: v[0] for k, v in sorted(g.items())}))
        check("Demo guide: with the statement delivered, the tenant-dispute step opens the Tenant link card",
              g[5] == ("now", f"/tenancy/{mo}?tab=tenants#tenant-link"), json.dumps(g[5]))
        shot(page, "statement-delivered")

        tenant = ctx.new_page()
        tenant.on("request", lambda r: asked_t.append((time.time(), r.url)) if r.method == "GET" else None)
        tenant.on("pageerror", lambda e: errors.append(f"pageerror (tenants): {e}"))
        go(tenant, setup["tenantPath"])
        t = sees("Tenants' page", tenant, "Your deposit refund", "1140 E. Juniper Hollow Ln", f"Refund amount\n\n{R}", f"Deposit paid\n{D}", f"Deductions\n−{P}", f"Refund\n{R}",
                 rid, "Bedroom carpet, replaced", "Right wall, repaired", "Range, cleaned", "Dispute it", "Itemized statement")
        only_amounts("Tenants' page", t, [E["refund"], E["deposit"], E["deductions"], *line_amounts, 50.0, 125.0])
        shot(tenant, "tenants-page")

        # 7. The tenants' dispute and their advocate's case (beat 5).
        tenant.get_by_role("link", name="Dispute it").first.click()
        tenant.get_by_text("Which charges?").wait_for()
        tenant.get_by_label("1. Bedroom carpet", exact=False).check()
        tenant.get_by_placeholder("What's wrong with this charge, in your words").fill("The stain was one small spot, and nobody asked us about cleaning it first.")
        # Asked without a name: refused on the page (nothing is sent), and the message goes when a name is picked.
        tenant.get_by_role("button", name="Ask my advocate").click()
        no_name = tenant.get_by_text("Pick your name.", exact=True)
        asked_for = no_name.count() == 1 and no_name.first.is_visible()
        tenant.get_by_label("Your name").select_option(label="Luke Jones")
        tenant.wait_for_timeout(200)
        check('Dispute form: "Pick your name." shows when a name is missing and goes when one is picked', asked_for and no_name.count() == 0,
              f"shown {asked_for}, still there after the pick {no_name.count() > 0}")
        tenant.get_by_role("button", name="Ask my advocate").click()
        tenant.get_by_role("region", name="Your advocate's case").wait_for(timeout=90_000)
        case_back = usd(E["case_back"])
        t = sees("Advocate's case", tenant, f"Your advocate proposes back\n\n{case_back}", f"On top of the {R} refund on the statement, from the {P} deducted.",
                 "Charge looks weak", "Charge looks solid", f"{case_back}\n\nback of {usd(E['carpet'])}", "Not legal advice")
        only_amounts("Advocate's case", t, [E["case_back"], E["refund"], E["deductions"], *line_amounts, 0.0])
        shot(tenant, "advocate-case")
        tenant.get_by_role("button", name=re.compile("^Send to Teddy Buettner")).click()
        tenant.get_by_role("alertdialog").get_by_role("button", name="Send", exact=True).click()
        tenant.get_by_text("You asked back").wait_for(timeout=30_000)
        sees("Dispute sent", tenant, f"You asked back\n{case_back}", "Sent to Teddy Buettner")
        shot(tenant, "dispute-sent")

        # 8. The negotiation (beat 6): the landlord's negotiator and the tenants' advocate, checked by code each turn.
        # The tenants' page stays open on the dispute they sent ("Their answer comes back to this page").
        stay(tenant)
        # The unit was closed out (statement delivered, refund sent); with a dispute waiting it is an open move-out again,
        # on Move-outs and on Properties alike: a unit with a live dispute is in neither Closed list nor Closed count.
        go(page, "/move-outs")
        row = next((r for r in page.locator("main table tbody tr").all_inner_texts() if "1140 E. Juniper Hollow Ln" in r), "")
        check("Move-outs: the disputed unit is listed under Open, with the dispute as its next step", "Disputed" in row and "Answer dispute" in row,
              f"its row under Open: {row!r}; the page reads: {text(page)[:300]!r}")
        go(page, "/units?filter=closed")
        shut = page.locator("main table tbody tr").all_inner_texts()
        check("Properties: the Closed filter lists the closed unit and not the one whose dispute is live",
              len(shut) == 1 and "482 N. Glassell St" in shut[0], f"rows under Closed: {shut}")
        tab = re.sub(r"\s+", "", page.locator("a[href='/units?filter=closed']").first.inner_text())
        check("Properties: the Closed count says one, the same rule as the list", tab == "Closed1", tab)
        go(page, "/units?filter=move-out")
        row = next((r for r in page.locator("main table tbody tr").all_inner_texts() if "1140 E. Juniper Hollow Ln" in r), "")
        check("Properties: the disputed unit is under Move-out instead, with the dispute as its next step", "Disputed" in row and "Answer dispute" in row,
              f"its row under Move-out: {row!r}; the page reads: {text(page)[:300]!r}")
        go(page, f"/tenancy/{mo}?tab=move-out")
        sees("Disputed", page, "Disputed", f"Luke Jones disputes 1 deduction and asks for {case_back} back.", "Let my negotiator answer")
        watch_button(page, r"^Let my negotiator answer$")
        page.get_by_role("button", name="Let my negotiator answer").click()
        page.get_by_text("Agreed back").first.wait_for(timeout=120_000)
        no_flash("Let my negotiator answer", page, r"^Let my negotiator answer$")
        b1, b2, b3 = (usd(x) for x in E["turns_back"])
        t = sees("Negotiation", page, "Settlement agreed", f"Agreed back\n{usd(E['settled'])}", f"Offers {b1} back", f"Asks {b2} back", f"Gives {b3} back",
                 "Your negotiator", "Their advocate", "Counters", "Concedes", f"Approve and pay {usd(E['settled'])}")
        # One turn's reasoning and figures, and a Why? on the negotiator's counter: its reason, with the pack's citation.
        page.get_by_text("Reasoning and figures").nth(1).click()
        page.wait_for_timeout(300)
        sees("Negotiator's figures", page, f"kept of {usd(E['carpet'])}", usd(E["carpet"] - E["turns_back"][0]))
        why = ""
        whys = page.get_by_role("button", name="Why?")
        for i in range(min(whys.count(), 40)):
            if not whys.nth(i).is_visible():
                continue
            whys.nth(i).hover()
            page.wait_for_timeout(120)
            tip = " ".join(page.locator("[role=tooltip]").all_inner_texts())
            if "Bedroom carpet" in tip and "The most the law and the record support" in tip:
                why = tip
                break
        check(f"Negotiation: the carpet's Why? gives the lawful range's top, {usd(E['carpet'])}, with a citation from the pack",
              f"support for it: {usd(E['carpet'])}" in why and "Civ. Code 1950.5" in why, why[:300] or "no such tip")
        shot(page, "negotiation")
        f2 = facts()
        turns = [cents(x["amount_back"]) for x in f2["turns"] if x["n"] > 1 and x["dispute_id"] in {d["id"] for d in f2["disputes"] if d["tenancy_id"] == mo}]
        check(f"Negotiation: the turns recorded give back {', '.join(usd(x) for x in E['turns_back'])}", turns == E["turns_back"], f"{turns}")

        # The tenants' page, never reloaded since they sent the dispute, shows the settlement the agents reached.
        live = arrives(tenant, lambda: tenant.get_by_text("Settlement offered").first.is_visible())
        check("Side by side: the tenants' page, left open, shows the settlement the agents reached without a reload", live, text(tenant)[:300])
        if not live:
            go(tenant, f"{setup['tenantPath']}/dispute")
        sees("Tenants see the settlement", tenant, f"Settlement offered\n{usd(E['settled'])}", "Both sides agree", f"Offers {b1} back", f"Asks {b2} back")

        # 9. The settlement (beat 7): both humans say yes, PayPal (fake) refunds the agreed amount, the statement amends.
        # The landlord's Move-out tab stays open beside it: "Approve and pay" is off until the tenants accept, and while
        # it waits the page asks its small status route and refreshes nothing.
        pay = page.get_by_role("button", name=re.compile(r"^Approve and pay")).first
        check("Side by side: Approve and pay is off until the tenants accept", pay.is_disabled() and "Waiting for Luke Jones and Lane Forti to accept." in text(page), text(page)[:300])
        stay(page)
        waited = time.time()
        page.wait_for_timeout(9000)
        polls, refreshes = asks(asked_l, waited, f"/tenancy/{mo}")
        check("Side by side: while it waits on the tenants, the landlord's page asks its status route every few seconds and refreshes nothing",
              2 <= polls <= 4 and refreshes == 0, f"{polls} status requests and {refreshes} refreshes in 9 s")
        tenant.get_by_label("Your name").select_option(label="Luke Jones")
        watch_button(tenant, r"^Accept settlement$|^Accepting\.\.\.$")
        tenant.get_by_role("button", name="Accept settlement").click()
        tenant.get_by_role("alertdialog").get_by_role("button", name="Accept settlement").click()
        tenant.get_by_text(re.compile(r"^Waiting for .* to approve$")).first.wait_for(timeout=30_000)
        no_flash("Accept settlement", tenant, r"^Accept settlement$")
        tenant.wait_for_load_state("networkidle")
        tenant.wait_for_timeout(800)
        shot(tenant, "tenants-accepted")
        accepted = time.time()
        live = arrives(page, lambda: pay.is_enabled())
        check("Side by side: the landlord's Move-out tab, left open, turns Approve and pay on after the tenants accept, without a reload", live,
              f"after {time.time() - accepted:.0f} s the card reads: {page.locator('#negotiation').inner_text()[:240]!r}")
        if live:
            print(f"  Approve and pay came on {time.time() - accepted:.1f} s after the tenants accepted", flush=True)
            sees("Side by side: the landlord's card says who accepted", page, "Waiting for you", "Accepted\nLuke Jones", "Approve and pay below")
        else:
            go(page, f"/tenancy/{mo}?tab=move-out")
        stay(tenant)
        watch_button(page, r"^Approve and pay|^Sending\.\.\.$")
        page.get_by_role("button", name=re.compile(r"^Approve and pay")).first.click()
        dlg = page.get_by_role("alertdialog")
        check("Approve and pay: asks first, naming the amount", f"Send {usd(E['settled'])} to Luke Jones and Lane Forti?" in dlg.inner_text(), dlg.inner_text()[:200])
        dlg.get_by_role("button", name="Approve and pay").click()
        page.get_by_text(f"Settled: {usd(E['settled'])} back").first.wait_for(timeout=90_000)
        no_flash("Approve and pay", page, r"^Approve and pay")
        f3 = facts()
        sets = [x for x in f3["settlements"] if x["tenancy_id"] == mo]
        spay = [p for p in f3["payments"] if p["tenancy_id"] == mo and p["kind"] == "settlement_refund"]
        sid = spay[0]["paypal_id"] if spay else ""
        check(f"Settlement: sent, {usd(E['settled'])}, one fake PayPal refund against the same deposit payment",
              len(sets) == 1 and sets[0]["status"] == "sent" and abs(float(sets[0]["amount"]) - E["settled"]) < 0.005 and len(spay) == 1 and sid.startswith("E2E") and sid != rid,
              json.dumps({"settlements": sets, "payments": spay})[:500])
        sees("Settled", page, "Closed", f"Settled: {usd(E['settled'])} back", sid, "Amended statement")
        shot(page, "settled")
        # The tenants' page, open since they accepted, shows the payment; then neither page asks again.
        live = arrives(tenant, lambda: tenant.get_by_text("Sent by PayPal").first.is_visible())
        check("Side by side: the tenants' page, left open, shows the settlement paid without a reload", live, text(tenant)[:300])
        if live:
            sees("Side by side: the tenants' page once paid", tenant, f"Settled\n{usd(E['settled'])}", "Sent by PayPal", sid)
        done = time.time()
        page.wait_for_timeout(9000)
        check("Side by side: once it is settled, neither page asks again", asks(asked_l, done)[0] == 0 and asks(asked_t, done)[0] == 0,
              f"landlord {asks(asked_l, done)[0]}, tenants {asks(asked_t, done)[0]} status requests in 9 s")
        go(page, f"/tenancy/{mo}/statement")
        t = sees("Amended statement", page, "Amended", f"Returned in all\n{usd(E['returned'])}", f"kept {usd(E['settled_keep'])} of {usd(E['carpet'])}",
                 f"Deductions on the statement\n{P}", f"Agreed adjustment\n−{usd(E['settled'])}", f"Deductions as settled\n{usd(E['kept'])}",
                 f"Refunded with the statement\n{R}", f"Settlement\n{usd(E['settled'])}", sid, rid)
        only_amounts("Amended statement", t, [E["deposit"], E["deductions"], E["refund"], E["returned"], E["settled"], E["kept"], E["settled_keep"], DEMO["lease_total"], *line_amounts, 1800.0, 50.0, 125.0])
        shot(page, "amended-statement")
        go(page, f"/tenancy/{mo}?tab=payments")
        t = sees("Payments tab", page, f"Collected\n{D}", f"Deductions as settled\n{usd(E['kept'])}", f"Still held\n$0.00", f"Returned\n{usd(E['returned'])}",
                 f"−{R}", f"−{usd(E['settled'])}", "Settlement", "Refund", rid, sid)
        only_amounts("Payments tab", t, [E["deposit"], E["kept"], 0.0, E["returned"], E["refund"], E["settled"], E["deductions"], *line_amounts])
        g = guide(page)
        check("Demo guide: all eight beats are ticked once the settlement is paid", [v[0] for _, v in sorted(g.items())] == ["done"] * 8,
              json.dumps({k: v[0] for k, v in sorted(g.items())}))
        sees("Demo guide, walked", page, "8 of 8 done")
        shot(page, "property-payments")

        # 10. Payments, the AG Grid ledger, and Insights (beat 3b), against the whole copy's figures as they stand now.
        E = {**E, **{k: v for k, v in expected(f3, U).items() if k in ("portfolio", "by_state")}}
        PF = E["portfolio"]
        go(page, "/ledger")
        page.locator(".ag-row").first.wait_for()
        t = sees("Payments ledger", page, f"Deposits held\n{usd(PF['held'])}", "Due back\n$0.00", "Settlement", "Demo example")
        rows = page.locator(".ag-row").evaluate_all("rs => rs.map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
        rtext = " | ".join(rows)
        for what, amt in (("the refund", E["refund"]), ("the settlement", E["settled"]), ("the deposit", E["deposit"])):
            check(f"Payments ledger: a grid row for {what}, {usd(amt)}", usd(amt) in rtext, rtext[:600])
        shot(page, "ledger")
        # PayPal's record in a row's details, for the three money rows of the move-out unit. The refund and the
        # settlement are read back from the fake PayPal and must be what it answered when each was made; the deposit is
        # the fake's invoice as it stands now: paid, partly refunded by the two, its payment the copy's fake capture.
        unit_row = lambda amount: re.compile(rf"1140 E\. Juniper Hollow Ln[\s\S]*{re.escape(usd(amount))}")
        rec = ledger_record("refunds", unit_row(E["refund"]), "ledger-refund-record")
        want = record_want_refund(refunds[0], setup["pool"]["capture"]) if refunds else {}
        check("Payments ledger: the refund row's PayPal's record is the fake PayPal's answer for it", rec == want, f"shown {json.dumps(rec)}, the fake returned {json.dumps(want)}")
        rec = ledger_record("settlements", unit_row(E["settled"]), "ledger-settlement-record")
        want = record_want_refund(spay[0], setup["pool"]["capture"]) if spay else {}
        check("Payments ledger: the settlement row's PayPal's record is the fake PayPal's answer for it", rec == want and want.get("PayPal's amount") == money_words(E["settled"]),
              f"shown {json.dumps(rec)}, the fake returned {json.dumps(want)}")
        rec = ledger_record("deposits", unit_row(E["deposit"]), "ledger-deposit-record")
        txn = next(p for p in f3["payments"] if p["tenancy_id"] == mo and p["kind"] == "deposit_invoice")["raw"]["transactions"][0]
        want = {"PayPal's invoice ID": setup["pool"]["invoice"], "PayPal's invoice number": "Not given", "PayPal's status": "PARTIALLY_REFUNDED",
                "PayPal's amount": money_words(E["deposit"]), "PayPal's paid amount": money_words(E["deposit"]), "PayPal's refunded amount": money_words(E["returned"]),
                "PayPal's payment ID": setup["pool"]["capture"], "PayPal's payment date": txn["payment_date"]}
        check("Payments ledger: the deposit row's PayPal's record is the fake PayPal's invoice as it stands, partly refunded by the refund and the settlement",
              rec == want, f"shown {json.dumps(rec)}, the fake holds {json.dumps(want)}")
        go(page, "/insights")
        page.locator(".ag-row").first.wait_for()
        page.wait_for_timeout(800)
        t = sees("Insights", page, f"Deposits held\n{usd(PF['held'])}", f"Collected\n{usd(PF['collected'])}", f"Returned\n{usd(PF['returned'])}",
                 f"{usd(PF['settled'])} of it in settlements", f"Kept as deductions\n{usd(PF['kept'])}")
        charts = page.locator(".ag-charts-wrapper canvas, canvas").count()
        check("Insights: the four AG Charts are drawn", charts >= 4, f"{charts} canvases")
        irows = " | ".join(page.locator(".ag-row").evaluate_all("rs => rs.map(r => r.innerText.replace(/\\s+/g, ' ').trim())"))
        check(f"Insights: the property grid's total row agrees ({usd(PF['collected'])} collected, {usd(PF['held'])} held)",
              usd(PF["collected"]) in irows and usd(PF["held"]) in irows and usd(PF["kept"]) in irows, irows[:600])
        shot(page, "insights")
        TXF = E["by_state"]["TX"]
        page.get_by_role("button", name=re.compile("^Texas")).first.click()
        page.wait_for_timeout(800)
        sees("Insights, Texas only", page, f"Deposits held\n{usd(TXF['held'])}", f"Collected\n{usd(TXF['collected'])}", f"Returned\n{usd(TXF['returned'])}", f"Kept as deductions\n{usd(TXF['kept'])}")
        shot(page, "insights-texas")

        # 11. The same lease twice: this copy already has a tenancy for the demo lease, so Start tenancy opens that
        # tenancy and makes no second one of it (src/lib/lease-key.ts). Last, so nothing above sees the extra page.
        f4 = facts()
        go(page, "/lease")
        page.locator("input[type=file]").set_input_files(str(REPO / "demo/lease-single-owner.pdf"))
        page.get_by_role("heading", name="Findings").wait_for(timeout=60_000)
        page.get_by_role("button", name="Start tenancy").click()
        page.wait_for_url(re.compile(r"/tenancy/[0-9a-f-]{36}"), timeout=60_000)
        check("Same lease twice: Start tenancy opens the tenancy this copy already has for that lease", f"/tenancy/{mo}" in page.url, page.url)
        sees("Same lease twice", page, "1140 E. Juniper Hollow Ln", "This lease already has a tenancy in this copy of the demo, so this opens it instead of starting a second one.")
        shot(page, "same-lease-again")
        f5 = facts()
        check("Same lease twice: no second tenancy and no second property were made",
              len(f5["tenancies"]) == len(f4["tenancies"]) and len({(t.get("properties") or {}).get("address") for t in f5["tenancies"]}) == len(f5["tenancies"]),
              f"{len(f4['tenancies'])} tenancies before, {len(f5['tenancies'])} after: {[(t.get('properties') or {}).get('address') for t in f5['tenancies']]}")

        # 12. The guide's own ground, last, so nothing above runs without it.
        #
        # 12a. The unit a beat runs on is the address docs/DEMO_SCRIPT.md names for it, not the copy's latest move-out:
        # the Texas unit's own page offers a move-out date and beat 8 sends a judge there, so a date set on it must
        # leave every step's link and tick where it was (liveUnit, src/lib/demo-guide.ts).
        go(page, "/units")
        before = guide(page)
        answered = page.evaluate("""async (id) => {
          const r = await fetch(`/api/tenancies/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ moveOutDate: new Date().toISOString().slice(0, 10) }) });
          return r.status; }""", tx)
        check("Demo guide: the Texas unit takes a move-out date of today, as its own page offers", answered == 200, f"the route answered {answered}")
        go(page, "/units")
        after = guide(page)
        check("Demo guide: a move-out date set on the Texas unit leaves every step where it was", after == before,
              f"was {json.dumps(before)}, now {json.dumps(after)}")
        check("Demo guide: the live beats still open the California move-out unit, and the multi-state beat the Texas one",
              all(f"/tenancy/{mo}" in (after[i][1] or "") for i in (2, 3, 4, 5, 6, 7)) and after[8][1] == f"/tenancy/{tx}",
              json.dumps({k: v[1] for k, v in sorted(after.items())}))

        # 12b. The ticks don't go stale: Next keeps a layout it has already rendered when a click opens another page
        # under it, so the panel asks its own route (src/app/api/demo/guide/route.ts) when the page under it changes.
        asked = page.evaluate("""async () => {
          const r = await fetch('/api/demo/guide', { cache: 'no-store' });
          return { status: r.status, body: await r.json() }; }""")
        steps = (asked.get("body") or {}).get("steps") or []
        check("Demo guide: its own route answers with this copy's eight steps, all of them done by now",
              asked["status"] == 200 and [x["n"] for x in steps] == [1, 2, 3, 4, 5, 6, 7, 8] and all(x["done"] for x in steps),
              json.dumps(asked)[:500])
        since = time.time()
        page.get_by_role("navigation", name="Main").get_by_role("link", name="Tenants").click()
        page.wait_for_url(re.compile(r"/tenants$"), timeout=30_000)
        page.wait_for_timeout(1500)
        again = [u for t, u in asked_l if t >= since and "/api/demo/guide" in u]
        check("Demo guide: a click from one page to another makes it read the copy again", len(again) >= 1,
              f"{len(again)} requests to its route since the click")
        check("Demo guide: it still shows the eight beats, all ticked, on the page the click opened",
              [v[0] for _, v in sorted(guide(page).items())] == ["done"] * 8, json.dumps(guide(page)))

        # 12c. Its controls: Hide puts it away for this browser and a reload keeps it away (the choice is a cookie the
        # server reads, so a hidden guide is never rendered at all), and Demo guide in the account menu brings it back.
        go(page, "/units")
        page.locator("section[aria-label='Demo guide']").get_by_role("button", name="Hide").click()
        check("Demo guide: Hide puts it away", page.locator("[data-guide-step]").count() == 0)
        go(page, "/units")
        check("Demo guide: it stays away after a reload, and the page never renders it",
              page.locator("section[aria-label='Demo guide']").count() == 0 and "Demo guide" not in text(page))
        page.get_by_role("button", name="Account").first.click()
        page.get_by_role("button", name="Demo guide").click()
        page.locator("[data-guide-step]").first.wait_for(timeout=10_000)
        check("Demo guide: Demo guide in the account menu brings it back, open", page.locator("[data-guide-step]").count() == 8)
        shot(page, "demo-guide")

        # 12d. The welcome, opened again from the account menu after the whole demo: it reads the copy again, as the
        # guide does, so it says what is true now (the deposit closed out, no longer held).
        since = time.time()
        page.get_by_role("button", name="Account").first.click()
        page.get_by_role("button", name="Welcome tour").click()
        page.locator("[data-welcome]").wait_for(timeout=10_000)
        words = re.sub(r"\s+", " ", page.locator("[data-welcome]").inner_text())
        asked_w = [u for t, u in asked_l if t >= since and "/api/demo/welcome" in u]
        check("Welcome: opened again after the close-out, it reads the copy again and says the deposit is closed out",
              len(asked_w) >= 1 and f"Their {dep} deposit is closed out." in words and "Close out their" not in words,
              f"{len(asked_w)} requests to its route; the card reads {words[:400]!r}")
        page.get_by_role("button", name="Show me around").click()
        page.locator("[data-tour-stop]").wait_for()
        page.wait_for_timeout(300)
        body = page.locator("[data-tour-stop] p").first.inner_text()
        check("Welcome tour: after the close-out, the move-out stop no longer calls the deposit held", "is held" not in body, body)
        page.keyboard.press("Escape")

        check("no page error or console error on the way", not errors, "; ".join(errors[:8]))
        browser.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--worktree", type=Path, help="make a temporary worktree here, build it, serve it on --port, walk it, remove it")
    ap.add_argument("--keep-worktree", action="store_true", help="leave the worktree and its build (and its copy of .env.local) for another run (--serve)")
    ap.add_argument("--serve", type=Path, help="serve this already-built directory on --port with the stubs on, walk it, stop it")
    ap.add_argument("--port", type=int, default=PORT, help=f"the port --worktree and --serve start the server on (default {PORT})")
    ap.add_argument("--base", help="walk a server already running with the stubs on (needs its GOOD_FAITH_SESSION_SECRET and GOOD_FAITH_ACCESS_CODE)")
    ap.add_argument("--shots", type=Path, help="where the screenshots and the server's log go (default: a new temporary folder)")
    ap.add_argument("--prepare", action="store_true", help="with --worktree: make and build it, then stop (serve it later with --serve)")
    ap.add_argument("--hold", action="store_true", help="with --serve: start the server and keep it up for --base runs (its test codes go to <shots>/codes.json)")
    ap.add_argument("--codes", type=Path, help="with --base: the codes.json a --hold server wrote")
    ap.add_argument("--log", type=Path, help="with --base: the running server's log, for the log checks (default: the server.log beside --codes)")
    ap.add_argument("--leftovers", action="store_true", help="list the copies earlier runs left (add --apply to remove them)")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    # A stop (SIGTERM, as from a task runner) ends the run the way Ctrl-C does, so the clean-up below still runs and
    # the server, which has a session of its own, doesn't outlive this script on its port.
    def stopped(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stopped)

    if a.leftovers:
        out = helper("leftovers", *(["--apply"] if a.apply else []))
        print(json.dumps(out["found"], indent=2))
        return 0
    if sum(bool(x) for x in (a.worktree, a.serve, a.base)) != 1:
        ap.error("pass exactly one of --worktree, --serve or --base")
    if a.worktree and a.worktree.exists():
        ap.error(f"{a.worktree} already exists: --worktree makes a new directory (and removes it afterwards)")
    if a.prepare:
        if not a.worktree:
            ap.error("--prepare goes with --worktree")
        try:
            make_worktree(a.worktree)
            build(a.worktree)
        except Exception as e:
            remove_worktree(a.worktree)
            print(f"couldn't prepare the worktree: {e}")
            return 2
        print(f"built: walk it with --serve {a.worktree}; it holds a copy of .env.local (real secrets), so remove it when done: "
              f"git -C {REPO} worktree remove --force {a.worktree}")
        return 0
    if not 1 <= a.port <= 65535:
        ap.error(f"--port {a.port} is not a port")

    shots = a.shots or Path(tempfile.mkdtemp(prefix="gf-e2e-"))
    shots.mkdir(parents=True, exist_ok=True)
    server, wt, made_wt, held = None, None, False, False
    codes = None
    setup = None
    root = REPO
    base_log, base_log_from = None, 0
    try:
        if a.base:
            base = a.base.rstrip("/")
            saved = json.loads(a.codes.read_text()) if a.codes else {}
            codes = {"secret": saved.get("secret") or os.environ.get("GOOD_FAITH_SESSION_SECRET", ""), "access": saved.get("access") or os.environ.get("GOOD_FAITH_ACCESS_CODE", "")}
            if len(codes["secret"]) < 32 or not codes["access"]:
                raise RuntimeError("--base needs the running server's GOOD_FAITH_SESSION_SECRET and GOOD_FAITH_ACCESS_CODE in the environment.")
            # The held server's log, read later from where it stands now, so only this run's lines count.
            base_log = a.log or (a.codes.parent / "server.log" if a.codes else None)
            if base_log and base_log.exists():
                base_log_from = base_log.stat().st_size
            elif a.log:
                raise RuntimeError(f"--log {a.log} doesn't exist.")
            else:
                base_log = None
        else:
            wt = a.worktree or a.serve
            if a.worktree:
                made_wt = True
                make_worktree(wt)
                build(wt)
            root = wt
            codes = new_codes()
            server = start_server(wt, codes, shots / "server.log", a.port)
            base = f"http://localhost:{a.port}"
            if a.hold:
                held = True
                up, stubbed = health(base)
                (shots / "codes.json").write_text(json.dumps(codes))
                print(f"serving {wt} on {base} (stubs {'on' if stubbed else 'OFF'}); test codes in {shots / 'codes.json'}, its log in {shots / 'server.log'}; stop with Ctrl-C", flush=True)
                try:
                    server.wait()
                except KeyboardInterrupt:
                    pass
                return 0
        up, stubbed = health(base)
        if not check("the server answers its health check", up):
            return 2
        if not check("the server says the e2e stubs are on (X-Good-Faith-E2E-Stubs), so no Claude or PayPal call can be real", stubbed,
                     "refusing to walk a server without the stubs: it would spend Claude calls and reach PayPal"):
            return 2

        env = {**os.environ, "GOOD_FAITH_SESSION_SECRET": codes["secret"], "GOOD_FAITH_ACCESS_CODE": codes["access"]}
        setup = helper("setup", env=env, root=root)
        print(f"copy: workspace {setup['ws']}, move-out unit {setup['units'].get('move_out')}, fake deposit {setup['pool']['invoice']}", flush=True)
        check("the test's copy has its three units, its closed unit's history and a tenant link for the move-out unit",
              len(setup["units"]) == 3 and setup.get("history", 0) >= 1 and bool(setup.get("tenantPath")), json.dumps({k: setup.get(k) for k in ("units", "history", "keyed")}))

        walk(base=base, setup=setup, shots=shots, check=check, facts=lambda: helper("facts", setup["ws"], root=root))
    except Exception as e:
        check("the run finished without an error", False, f"{type(e).__name__}: {e}")
    finally:
        if setup:
            try:
                rep = helper("cleanup", setup["ws"], setup["sid"], root=root)
                check("clean-up: the copy, its rows and files, its fake deposit and its daily-limit rows are gone, the units given back",
                      rep["ok"], json.dumps(rep))
                print(f"clean-up: gave back {rep['usageGivenBack']}, removed {rep['usageRowsRemoved']} usage rows and {rep['poolRowsRemoved']} fake deposit; sweep: {rep['sweep'] and rep['sweep']['out']}", flush=True)
            except Exception as e:
                check("clean-up", False, f"{e}. Run: python scripts/e2e-demo.py --leftovers --apply")
        stop_server(server)
        if server and not held:
            log = (shots / "server.log").read_text(errors="replace") if (shots / "server.log").exists() else ""
            server_log_checks(log, log)
        elif a.base and setup:
            if base_log:
                raw = base_log.read_bytes()
                print(f"server log: {base_log}, from byte {base_log_from}", flush=True)
                server_log_checks(raw.decode(errors="replace"), raw[base_log_from:].decode(errors="replace"))
            else:
                print("SKIPPED the server-log checks (the banner, the stubs answering each Claude job, no real PayPal or Claude call): "
                      "--base has no log to read (pass --log, or --codes beside its server.log); the health check's stubs header was the only guard", flush=True)
        if made_wt and not a.keep_worktree:
            remove_worktree(wt)
            check("the temporary worktree is removed", not wt.exists())
        elif made_wt:
            print(f"kept the worktree {wt}: it holds a copy of .env.local (real secrets), so remove it when done: git -C {REPO} worktree remove --force {wt}", flush=True)
        print(f"screenshots and the server's log: {shots}")
        print(f"{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
