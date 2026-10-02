"""Pay a sandbox PayPal invoice as the test tenant. Usage: pay_invoice.py INVOICE_ID
The login comes from PAYPAL_SANDBOX_BUYER_EMAIL and PAYPAL_SANDBOX_BUYER_PASSWORD in the environment (demo-seed.mjs
passes them), else from .env.local read the same way demo-common.mjs reads it. Neither is ever printed.
Screenshots of the checkout go to a private temp folder (mode 700): removed once the payment is submitted, named
when something goes wrong, since the login page shows the sandbox email.
Exits 1 when the checkout never showed a PayPal button, the login didn't go through or no pay button appeared, so
demo-seed.mjs can stop with a clear message."""
import asyncio, os, shutil, sys, tempfile
from pathlib import Path
from playwright.async_api import async_playwright


def load_env():
    """.env.local as demo-common.mjs loadEnv reads it: comments skipped, one pair of surrounding quotes dropped."""
    env = {}
    path = Path(__file__).resolve().parents[1] / ".env.local"
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        t = line.strip()
        if not t or t.startswith("#") or "=" not in t:
            continue
        k, v = t.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] == '"':
            v = v[1:-1]
        env[k.strip()] = v
    return env


FILE_ENV = None


def cred(key):
    global FILE_ENV
    v = os.environ.get(key)
    if v:
        return v
    if FILE_ENV is None:
        FILE_ENV = load_env()
    v = FILE_ENV.get(key)
    if not v:
        sys.exit(f"{key} is not set; run scripts/setup-sandbox-tenant.sh")
    return v


SHOT_DIR = tempfile.mkdtemp(prefix="pp-")  # private to this user
SHOT = SHOT_DIR + "/"
URL = f"https://www.sandbox.paypal.com/invoice/p/#{sys.argv[1]}"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1100, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until="domcontentloaded", timeout=60000)
        frame = None
        for _ in range(40):
            frame = next((f for f in pg.frames if "smart/buttons" in f.url), None)
            if frame: break
            await pg.wait_for_timeout(500)
        if not frame:
            await pg.screenshot(path=SHOT + "x_nobutton.png"); print("no PayPal button frame; see " + SHOT + "x_nobutton.png"); sys.exit(1)
        try: await pg.click("text=Yes, I accept", timeout=3000)
        except Exception: pass
        await frame.wait_for_selector("[data-funding-source=paypal]", timeout=20000)
        async with ctx.expect_page(timeout=30000) as pop_info:
            await frame.click("[data-funding-source=paypal]")
        pop = await pop_info.value
        await pop.wait_for_load_state("domcontentloaded")
        # PayPal serves two login pages: the classic split login (#btnNext, #btnLogin) and a newer one whose buttons
        # have no ids. Both name the buttons "Next" and "Log In" and keep #email and #password, so go by those. The
        # inactive panel stays in the DOM, so a click (which waits until the button receives events) is the proof
        # that a panel is on screen; Next is retried if the password panel doesn't take.
        try:
            await pop.locator("#email:visible, #password:visible").first.wait_for(timeout=30000)
            await pop.screenshot(path=SHOT + "1_login.png")
            if await pop.locator("#email:visible").count():
                await pop.locator("#email").fill(cred("PAYPAL_SANDBOX_BUYER_EMAIL"))
            await pop.wait_for_timeout(500)
            for attempt in range(4):
                nxt = pop.get_by_role("button", name="Next", exact=True)
                if await nxt.count():
                    try: await nxt.first.click(timeout=5000)
                    except Exception: pass
                    await pop.wait_for_timeout(2500)
                try:
                    await pop.locator("#password").fill(cred("PAYPAL_SANDBOX_BUYER_PASSWORD"), timeout=5000)
                    await pop.screenshot(path=SHOT + "2_password.png")
                    await pop.get_by_role("button", name="Log In", exact=True).first.click(timeout=6000)
                    break
                except Exception:
                    if attempt == 3: raise
        except Exception as e:
            await pop.screenshot(path=SHOT + "x_login.png")
            print(f"login didn't go through ({type(e).__name__}); see {SHOT}x_login.png"); sys.exit(1)
        await pop.wait_for_timeout(9000)
        await pop.screenshot(path=SHOT + "3_review.png")
        btns = [t.strip() for t in await pop.locator("button").all_inner_texts() if t.strip()]
        print("review buttons:", btns[:12])
        clicked = False
        for label in ["Complete Purchase", "Pay Now", "Pay", "Continue"]:
            loc = pop.get_by_role("button", name=label, exact=True)
            if await loc.count():
                await loc.first.click(); clicked = True; print("clicked:", label); break
        if not clicked:
            print("no pay button found; see " + SHOT + "3_review.png"); sys.exit(1)
        submitted = False
        try:
            await pop.wait_for_event("close", timeout=40000); print("popup closed: payment submitted"); submitted = True
        except Exception:
            await pop.screenshot(path=SHOT + "4_after.png"); print(f"popup still open; see {SHOT}4_after.png")
        await pg.wait_for_timeout(6000)
        await pg.screenshot(path=SHOT + "5_invoice_after.png")
        await b.close()
        if submitted:
            shutil.rmtree(SHOT_DIR, ignore_errors=True)
        else:
            print(f"screenshots kept in {SHOT_DIR}")


asyncio.run(main())
