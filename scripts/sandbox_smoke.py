"""Sandbox smoke test for the PayPal money loop (2026-10-01). Standard library only.

Proves, in PayPal's sandbox, the three money moves the deposit agent needs:
  1. Collect the deposit: create and send a PayPal invoice to the tenant.
  2. Return the deposit: a Payout to the tenant's PayPal email.
  3. Return the deposit to Venmo: a Payout with recipient_wallet VENMO (to learn whether the sandbox accepts it).
Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from .env.local. Prints statuses, never the secret.
Run: python3 scripts/sandbox_smoke.py [tenant_email]
"""
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api-m.sandbox.paypal.com"
ENV = dict(l.split("=", 1) for l in (Path(__file__).resolve().parents[1] / ".env.local").read_text().splitlines()
           if "=" in l and not l.startswith("#"))
TENANT = sys.argv[1] if len(sys.argv) > 1 else "tenant-demo@example.com"


def call(method: str, path: str, body: dict | None = None, token: str | None = None, form: bytes | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        auth = base64.b64encode(f"{ENV['PAYPAL_CLIENT_ID']}:{ENV['PAYPAL_CLIENT_SECRET']}".encode()).decode()
        headers = {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"}
    data = form if form is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw[:300].decode(errors="ignore")}


def main() -> None:
    _, tok = call("POST", "/v1/oauth2/token", form=b"grant_type=client_credentials")
    token = tok["access_token"]
    print("token ok")

    # 1. Deposit invoice
    st, inv = call("POST", "/v2/invoicing/invoices", token=token, body={
        "detail": {"currency_code": "USD", "note": "Security deposit, 123 Demo St, Orange CA. Held per Civil Code 1950.5.",
                   "terms_and_conditions": "Refundable per California Civil Code 1950.5.", "payment_term": {"term_type": "DUE_ON_RECEIPT"}},
        "invoicer": {"name": {"given_name": "Demo", "surname": "Landlord"}},
        "primary_recipients": [{"billing_info": {"email_address": TENANT}}],
        "items": [{"name": "Security deposit", "quantity": "1", "unit_amount": {"currency_code": "USD", "value": "2800.00"}}],
    })
    inv_id = inv.get("id") or (inv.get("href", "").rsplit("/", 1)[-1] if inv.get("href") else None)
    print("1. create invoice:", st, inv_id or inv)
    if inv_id:
        st, sent = call("POST", f"/v2/invoicing/invoices/{inv_id}/send", token=token, body={"send_to_invoicer": False})
        print("   send invoice:", st, sent.get("href", sent) if isinstance(sent, dict) else sent)
        st, got = call("GET", f"/v2/invoicing/invoices/{inv_id}", token=token)
        print("   invoice status:", got.get("status"), "| pay link:", next((l["href"] for l in got.get("links", []) if l.get("rel") == "payer-view"), None))

    # 2. Payout to a PayPal email
    batch = f"smoke-{int(time.time())}"
    st, po = call("POST", "/v1/payments/payouts", token=token, body={
        "sender_batch_header": {"sender_batch_id": batch, "email_subject": "Your security deposit refund",
                                "email_message": "Deposit refund per the itemized statement."},
        "items": [{"recipient_type": "EMAIL", "receiver": TENANT, "note": "Deposit refund",
                   "amount": {"currency": "USD", "value": "1.00"}, "sender_item_id": "refund-1"}],
    })
    print("2. payout to PayPal email:", st, po.get("batch_header", {}).get("batch_status", po))

    # 3. Payout to Venmo
    st, pv = call("POST", "/v1/payments/payouts", token=token, body={
        "sender_batch_header": {"sender_batch_id": batch + "-venmo", "email_subject": "Your security deposit refund"},
        "items": [{"recipient_type": "PHONE", "receiver": "4085551234", "recipient_wallet": "VENMO",
                   "note": "Deposit refund", "amount": {"currency": "USD", "value": "1.00"}, "sender_item_id": "refund-venmo-1"}],
    })
    print("3. payout to Venmo:", st, pv.get("batch_header", {}).get("batch_status", pv.get("name", pv)), pv.get("message", ""))
    pb = pv.get("batch_header", {}).get("payout_batch_id")
    if pb:
        time.sleep(4)
        st, detail = call("GET", f"/v1/payments/payouts/{pb}", token=token)
        for it in detail.get("items", []):
            print("   venmo item:", it.get("transaction_status"), it.get("errors", {}).get("name", ""))


if __name__ == "__main__":
    main()
