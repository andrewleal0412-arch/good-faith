"""Pay a sandbox PayPal invoice as the test tenant (PAYPAL_SANDBOX_BUYER_* in .env.local). Usage: pay_invoice.py INVOICE_ID"""
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright
env = dict(l.split("=", 1) for l in Path(__file__).resolve().parents[1] / ".env.local".read_text().splitlines() if "=" in l)
SHOT = "/tmp/pp-"
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
            await pg.screenshot(path=SHOT + "x_nobutton.png"); print("no PayPal button frame"); return
        try: await pg.click("text=Yes, I accept", timeout=3000)
        except Exception: pass
        await frame.wait_for_selector("[data-funding-source=paypal]", timeout=20000)
        async with ctx.expect_page(timeout=30000) as pop_info:
            await frame.click("[data-funding-source=paypal]")
        pop = await pop_info.value
        await pop.wait_for_load_state("domcontentloaded")
        await pop.fill("#email", env["PAYPAL_SANDBOX_BUYER_EMAIL"], timeout=20000)
        await pop.click("#btnNext")
        await pop.fill("#password", env["PAYPAL_SANDBOX_BUYER_PASSWORD"], timeout=20000)
        await pop.click("#btnLogin")
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
            print("no pay button found"); return
        try:
            await pop.wait_for_event("close", timeout=40000); print("popup closed: payment submitted")
        except Exception:
            await pop.screenshot(path=SHOT + "4_after.png"); print("popup still open; see 4_after.png")
        await pg.wait_for_timeout(6000)
        await pg.screenshot(path=SHOT + "5_invoice_after.png")
        await b.close()
asyncio.run(main())
