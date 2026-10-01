#!/bin/zsh
# Store the PayPal SANDBOX personal (test tenant) login so automated tests can pay invoices (2026-10-01).
# developer.paypal.com > Testing Tools > Sandbox Accounts > the Personal account > View/Edit Account.
# Fake money only. Goes into .env.local (gitignored, mode 600), never printed.
set -e
cd "${0:A:h}/.."
read "email?Sandbox personal email (sb-...@personal.example.com): "
read -s "pw?Sandbox personal password (hidden): "; print
[[ "$email" != *@*.example.com ]] && { print "That doesn't look like a sandbox email (ends in example.com). Nothing saved."; exit 1; }
umask 077
touch .env.local
grep -v '^PAYPAL_SANDBOX_BUYER_' .env.local > .env.local.tmp 2>/dev/null || true
{ cat .env.local.tmp; print "PAYPAL_SANDBOX_BUYER_EMAIL=$email"; print "PAYPAL_SANDBOX_BUYER_PASSWORD=$pw"; } > .env.local
rm -f .env.local.tmp
print "Saved the test tenant login."
