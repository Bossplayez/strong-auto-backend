#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Strong Auto — List DB Backups in Cloudflare R2
# ============================================================
#  Lists all available database backups stored in R2.
#
#  Usage:
#    ./scripts/list-backups.sh
# ============================================================

# --- Load .env if running locally ---
if [[ -f "$(dirname "$0")/../.env" ]]; then
  set -a
  source "$(dirname "$0")/../.env"
  set +a
fi

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"

BUCKET="${R2_BUCKET_NAME:-strong-auto-backups}"

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Available DB backups in s3://${BUCKET}/db-backups/:"
echo "-------------------------------------------"
aws s3 ls "s3://${BUCKET}/db-backups/" \
  --endpoint-url "${R2_ENDPOINT}" \
  --region auto \
  --human-readable \
  | sort -r
