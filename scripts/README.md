# Scripts — Strong Auto Backend

## Database Backup & Restore

Scripts for backing up and restoring the PostgreSQL database to/from Cloudflare R2.

### Prerequisites

- `pg_dump` / `psql` (from PostgreSQL client tools)
- `aws-cli` (for R2 uploads/downloads)
- `gzip` / `gunzip`

### Required Environment Variables

All scripts read from the project `.env` file or the environment:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Railway) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 access key ID |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `R2_BUCKET_NAME` | R2 bucket name (default: `strong-auto-backups`) |

### Backup

```bash
# Run backup (uploads to R2 as db-backups/backup-YYYY-MM-DD.sql.gz)
./scripts/backup-db.sh
```

### Restore

```bash
# Restore latest backup (will prompt for confirmation)
./scripts/restore-db.sh

# Restore specific backup
./scripts/restore-db.sh backup-2025-01-15.sql.gz
```

### List Backups

```bash
# List all available backups in R2
./scripts/list-backups.sh
```

### Automation (cron / Railway cron)

To run daily backups, add to crontab:

```cron
0 3 * * * cd /path/to/strong-auto-backend && ./scripts/backup-db.sh >> /var/log/db-backup.log 2>&1
```

Or set up a Railway cron job that runs `./scripts/backup-db.sh` daily.
