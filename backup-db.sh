#!/usr/bin/env bash
set -euo pipefail
# Backup lógico do PostgreSQL FABUZADA. Salva fora da pasta web.
cd "$(dirname "$0")"
[[ -f backend/.env ]] || { echo 'backend/.env não encontrado'; exit 1; }
DB_URL="$(sed -n 's/^DATABASE_URL=//p' backend/.env | head -n 1)"
[[ -n "$DB_URL" ]] || { echo 'DATABASE_URL não configurado'; exit 1; }
command -v pg_dump >/dev/null || { echo 'pg_dump não instalado (pacote postgresql-client)'; exit 1; }
BACKUP_DIR="${FABUZADA_BACKUP_DIR:-$HOME/fabuzada-backups}"
umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
NOW="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/fabuzada-$NOW.dump"
pg_dump --format=custom --no-owner --no-acl --file "$FILE" "$DB_URL"
chmod 600 "$FILE"
# Mantém as últimas 14 cópias, sem apagar outros arquivos.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'fabuzada-*.dump' -printf '%T@ %p\n' | sort -nr | tail -n +15 | cut -d' ' -f2- | while IFS= read -r old; do rm -f -- "$old"; done
printf 'Backup criado com sucesso em: %s\n' "$FILE"
