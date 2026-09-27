#!/usr/bin/env bash
# snapshot.sh <database-url> <out-file> [columns-file]
#
# One line per table: name, row count, and an md5 over every row. The first
# run also writes <out-file>.cols, the columns each table had; pass that file
# to a later run to hash only those columns, so a table that gained columns
# in an upgrade is compared on the data it had before.
set -euo pipefail
URL=${1%%\?*}
OUT=$2
COLS=${3:-}

if [ -z "$COLS" ]; then
  psql "$URL" -At -F '|' -c "
    select table_name, string_agg(quote_ident(column_name), ',' order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name <> '_prisma_migrations'
    group by table_name order by 1" > "$OUT.cols"
  COLS="$OUT.cols"
fi

: > "$OUT"
while IFS='|' read -r table cols; do
  [ -z "$table" ] && continue
  row=$(psql "$URL" -At -c "
    select count(*) || ' ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-')
    from (select row($cols) as x from \"$table\") s" < /dev/null)
  echo "$table $row" >> "$OUT"
done < "$COLS"
