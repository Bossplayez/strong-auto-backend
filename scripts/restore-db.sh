#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Strong Auto — Restore PostgreSQL from Cloudflare R2
# ============================================================
#  Downloads a backup from R2 and restores it to DATABASE_URL.
#
#  Usage:
#    ./scripts/restore-db.sh                        # latest
#    ./scripts/restore-db.sh backup-2025-01-15.sql.gz
#
#  ⚠️  WARNING: This overwrites all data in the target DB!
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
BACKUP_FILE="${1:-}"
LOG_PREFIX="[restore-db]"

# --- Configure aws-cli for R2 ---
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# --- Determine which backup to restore ---
if [[ -z "${BACKUP_FILE}" ]]; then
  echo "${LOG_PREFIX} No file specified, fetching latest backup..."
  LATEST=$(aws s3 ls "s3://${BUCKET}/db-backups/" \
    --endpoint-url "${R2_ENDPOINT}" \
    --region auto | sort | tail -1 | awk '{print $4}')

  if [[ -z "${LATEST}" ]]; then
    echo "${LOG_PREFIX} ERROR: No backups found in s3://${BUCKET}/db-backups/" >&2
    exit 1
  fi
  BACKUP_FILE="${LATEST}"
  echo "${LOG_PREFIX} Latest backup: ${BACKUP_FILE}"
fi

# --- Safety confirmation ---
echo ""
echo "⚠️  WARNING: This will OVERWRITE all data in the target database!"
echo "   Target: ${DATABASE_URL#@}" | sed 's/:[^:@]*@/:***@/'
echo "   Restore from: ${BACKUP_FILE}"
echo ""
read -rp "Type 'RESTORE' to proceed: " CONFIRM
if [[ "${CONFIRM}" != "RESTORE" ]]; then
  echo "${LOG_PREFIX} Aborted."
  exit 0
fi

# --- Download backup ---
TMP_FILE="/tmp/${BACKUP_FILE}"
echo "${LOG_PREFIX} Downloading ${BACKUP_FILE}..."
if ! aws s3 cp "s3://${BUCKET}/db-backups/${BACKUP_FILE}" "${TMP_FILE}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --region auto; then
  echo "${LOG_PREFIX} ERROR: Download failed!" >&2
  exit 1
fi

# --- Restore ---
echo "${LOG_PREFIX} Restoring database..."
if gunzip -c "${TMP_FILE}" | psql "${DATABASE_URL}" --quiet; then
  echo "${LOG_PREFIX} ✅ Restore complete from ${BACKUP_FILE}"
else
  echo "${LOG_PREFIX} ERROR: Restore failed!" >&2
  rm -f "${TMP_FILE}"
  exit 1
fi

# --- Cleanup ---
rm -f "${TMP_FILE}"
echo "${LOG_PREFIX} Done at $(date '+%Y-%m-%d %H:%M:%S')"
