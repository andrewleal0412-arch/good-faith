#!/bin/zsh
# Store the app's own Anthropic API key for local development (2026-10-01).
# Create it at console.anthropic.com > API Keys, with a monthly spend limit (Billing > Limits).
# Goes into .env.local (gitignored, mode 600), never printed.
set -e
cd "${0:A:h}/.."
read -s "key?Anthropic API key (hidden): "; print
[[ "$key" != sk-ant-* ]] && { print "That doesn't look like an Anthropic key (should start with sk-ant-). Nothing saved."; exit 1; }
umask 077
touch .env.local
grep -v '^ANTHROPIC_API_KEY=' .env.local > .env.local.tmp 2>/dev/null || true
{ cat .env.local.tmp; print "ANTHROPIC_API_KEY=$key"; } > .env.local
rm -f .env.local.tmp
code=$(curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/models -H "x-api-key: $key" -H "anthropic-version: 2023-06-01")
[[ "$code" == 200 ]] && print "Saved, and Anthropic accepted the key." || print "Saved, but Anthropic returned HTTP $code. Check the key."
