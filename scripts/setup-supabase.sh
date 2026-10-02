#!/bin/zsh
# Store the Supabase project URL and its SECRET key for the app's server (2026-10-01).
# Supabase dashboard > your project > Project Settings > API Keys: the Project URL and a Secret key (sb_secret_...).
# Server-only: the key bypasses row level security. Goes into .env.local (gitignored, mode 600), never printed.
set -e
cd "${0:A:h}/.."
read "url?Supabase project URL (https://<ref>.supabase.co): "
url="${url%/}"
[[ "$url" != https://*.supabase.co ]] && { print "That doesn't look like a Supabase project URL (https://<ref>.supabase.co). Nothing saved."; exit 1; }
read -s "key?Supabase secret key (hidden): "; print
[[ "$key" != sb_secret_* && "$key" != eyJ* ]] && { print "That doesn't look like a Supabase secret key (sb_secret_...). Nothing saved."; exit 1; }
umask 077
touch .env.local
grep -v '^SUPABASE_' .env.local > .env.local.tmp 2>/dev/null || true
{ cat .env.local.tmp; print "SUPABASE_URL=$url"; print "SUPABASE_SECRET_KEY=$key"; } > .env.local
rm -f .env.local.tmp
code=$(curl -s -o /dev/null -w "%{http_code}" "$url/rest/v1/properties?select=id&limit=1" -H "apikey: $key" -H "Authorization: Bearer $key")
[[ "$code" == 200 ]] && print "Saved, and Supabase accepted the key." || print "Saved, but Supabase returned HTTP $code. Check the URL is this project's and the key is the SECRET key, not the publishable one."
