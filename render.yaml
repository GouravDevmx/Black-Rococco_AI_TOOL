#!/usr/bin/env bash
# Runs the full regression suite against a pristine database.
#
# The suite creates real bookings, so it is NOT idempotent against a dirty DB:
# a second run would hit an already-booked slot and get a (correct) 409.
# Snapshot the local JSON DB, run, restore.
set -e
cd "$(dirname "$0")/.."

DB=data/db.json
BACKUP=$(mktemp)
[ -f "$DB" ] && cp "$DB" "$BACKUP"

cleanup() {
  kill %1 2>/dev/null || true
  [ -f "$BACKUP" ] && cp "$BACKUP" "$DB" && rm -f "$BACKUP"
}
trap cleanup EXIT

node server.js > /tmp/regression-server.log 2>&1 &
sleep 2

node test/regression.test.js
STATUS=$?

echo ""
echo "─── server log: uncaught errors / 500s ───"
if grep -iE "UNCAUGHT|UNHANDLED|Error:" /tmp/regression-server.log | grep -v "processClientReminders" | head; then
  echo "  ^^ investigate"
else
  echo "  none"
fi

exit $STATUS
