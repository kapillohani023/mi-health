#!/usr/bin/env bash
# Pushes GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from the environment into the Worker as secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID}"
: "${GOOGLE_CLIENT_SECRET:?set GOOGLE_CLIENT_SECRET}"
printf '%s' "$GOOGLE_CLIENT_ID" | npx wrangler secret put GOOGLE_CLIENT_ID
printf '%s' "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET
echo "Done. Check: curl -s https://mi-health.kapil-lohani.workers.dev/health"
