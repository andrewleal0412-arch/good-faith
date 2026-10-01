#!/bin/zsh
# Store the Supabase project's SECRET key for the app's server (2026-10-01).
# Supabase dashboard > project deposit-agent > Project Settings > API Keys > Secret keys (sb_secret_...).
# Server-only: it bypasses row level security. Goes into .env.local (gitignored, mode 600), never printed.
set -e
cd "${0:A:h}/.."
URL="https://fawixodnaezbziffkeub.supabase.co"
read -s "key?Supabase secret key (hidden): "; print
[[ "$key" != sb_secret_* && "$key" != eyJ* ]] && { print "That doesn't look like a Supabase secret key (sb_secret_...). Nothing saved."; exit 1; }
umask 077
touch .env.local
grep -v '^SUPABASE_' .env.local > .env.local.tmp 2>/dev/null || true
{ cat .env.local.tmp; print "SUPABASE_URL=$URL"; print "SUPABASE_SECRET_KEY=$key"; } > .env.local
rm -f .env.local.tmp
code=$(curl -s -o /dev/null -w "%{http_code}" "$URL/rest/v1/properties?select=id&limit=1" -H "apikey: $key" -H "Authorization: Bearer $key")
[[ "$code" == 200 ]] && print "Saved, and Supabase accepted the key." || print "Saved, but Supabase returned HTTP $code. Check it's the SECRET key, not the publishable one."
