#!/usr/bin/env bash

# ==============================================================================
# SendaGo AI Gateway — Automated Database Backup Script
# ==============================================================================

set -eo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}"

echo "=================================================="
echo "📦 Starting SendaGo AI Database Backup..."
echo "Timestamp: ${TIMESTAMP}"
echo "=================================================="

# 1. Backup SQLite Database (if using SQLite)
if [ -f "./data/db/data.sqlite" ]; then
    SQLITE_BACKUP_FILE="${BACKUP_DIR}/sqlite_backup_${TIMESTAMP}.sqlite"
    
    # Use SQLite safe online backup via docker or local sqlite3
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 ./data/db/data.sqlite ".backup '${SQLITE_BACKUP_FILE}'"
    else
        cp ./data/db/data.sqlite "${SQLITE_BACKUP_FILE}"
    fi

    gzip -f "${SQLITE_BACKUP_FILE}"
    echo "✅ SQLite Backup created: ${SQLITE_BACKUP_FILE}.gz ($(du -sh "${SQLITE_BACKUP_FILE}.gz" | cut -f1))"
fi

# 2. Backup PostgreSQL Database (if container is running)
if docker ps --format '{{.Names}}' | grep -q "sendago-postgres"; then
    PG_BACKUP_FILE="${BACKUP_DIR}/postgres_backup_${TIMESTAMP}.sql.gz"
    docker exec sendago-postgres pg_dumpall -U sendago_admin | gzip > "${PG_BACKUP_FILE}"
    echo "✅ PostgreSQL Backup created: ${PG_BACKUP_FILE} ($(du -sh "${PG_BACKUP_FILE}" | cut -f1))"
fi

# 3. Clean up backups older than retention period
echo "🧹 Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "*backup_*.gz" -type f -mtime +${RETENTION_DAYS} -delete

echo "=================================================="
echo "🎉 Backup Completed Successfully!"
echo "=================================================="
