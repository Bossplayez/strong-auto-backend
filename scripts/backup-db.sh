#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Strong Auto — PostgreSQL Backup → Cloudflare R2
# ============================================================
#  Reads DATABASE_URL from env (or .env file), runs pg_dump,
#  gzips the result, and uploads to R2 via aws-cli.
#
#  Required env:
#    DATABASE_URL          — postgres connection string
#    R2_ACCOUNT_ID         — Cloudflare account ID
#    R2_ACCESS_KEY_ID      — R2 access key
#    R2_SECRET_ACCESS_KEY  — R2 secret key
#    R2_BUCKET_NAME        — R2 bucket (default: strong-auto-backups)
#
#  Usage:
#    ./scripts/backup-db.sh
#    DATABASE_URL=postgres://... ./scripts/backup-db.sh
# ============================================================

# --- Load .env if running locally ---
if [[ -f "$(dirname "$0")/../.env" ]]; then
  set -a
  source "$(dirname "$0")/../.env"
  set +a
fi

# --- Validate required vars ---
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"

BUCKET="${R2_BUCKET_NAME:-strong-auto-backups}"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="backup-${DATE}.sql.gz"
TMP_FILE="/tmp/${FILENAME}"
LOG_PREFIX="[backup-db]"

echo "${LOG_PREFIX} Starting database backup..."

# --- Run pg_dump ---
echo "${LOG_PREFIX} Running pg_dump..."
if ! pg_dump "${DATABASE_URL}" | gzip > "${TMP_FILE}"; then
  echo "${LOG_PREFIX} ERROR: pg_dump failed!" >&2
  exit 1
fi

DUMP_SIZE=$(du -h "${TMP_FILE}" | cut -f1)
echo "${LOG_PREFIX} Dump created: ${FILENAME} (${DUMP_SIZE})"

# --- Configure aws-cli for R2 ---
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# --- Upload to R2 ---
echo "${LOG_PREFIX} Uploading to R2 bucket: ${BUCKET}..."
if aws s3 cp "${TMP_FILE}" \
  "s3://${BUCKET}/db-backups/${FILENAME}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --region auto; then
  echo "${LOG_PREFIX} ✅ Upload complete: s3://${BUCKET}/db-backups/${FILENAME}"
else
  echo "${LOG_PREFIX} ERROR: R2 upload failed!" >&2
  rm -f "${TMP_FILE}"
  exit 1
fi

# --- Cleanup ---
rm -f "${TMP_FILE}"
echo "${LOG_PREFIX} Done at $(date '+%Y-%m-%d %H:%M:%S')"
