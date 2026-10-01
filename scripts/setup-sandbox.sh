#!/bin/zsh
# Store the PayPal SANDBOX app credentials for local development (2026-10-01).
# Get them at developer.paypal.com > Apps & Credentials > Sandbox > Default Application.
# They go into .env.local (gitignored, mode 600) and are never printed.
set -e
cd "${0:A:h}/.."
print "PayPal sandbox credentials (Apps & Credentials > Sandbox > your app)."
read "cid?Client ID: "
read -s "secret?Secret (hidden): "; print
[[ -z "$cid" || -z "$secret" ]] && { print "Both are required; nothing saved."; exit 1; }
umask 077
touch .env.local
grep -v '^PAYPAL_' .env.local > .env.local.tmp 2>/dev/null || true
{ cat .env.local.tmp; print "PAYPAL_ENVIRONMENT=SANDBOX"; print "PAYPAL_CLIENT_ID=$cid"; print "PAYPAL_CLIENT_SECRET=$secret"; } > .env.local
rm -f .env.local.tmp
# Check the keys work: ask PayPal for a sandbox access token.
code=$(curl -s -o /dev/null -w "%{http_code}" -u "$cid:$secret" -d grant_type=client_credentials https://api-m.sandbox.paypal.com/v1/oauth2/token)
[[ "$code" == 200 ]] && print "Saved, and PayPal accepted the keys." || print "Saved, but PayPal returned HTTP $code. Check you copied the SANDBOX keys."
