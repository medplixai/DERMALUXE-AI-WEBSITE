#!/bin/bash
# Every test, from the repo root:   ./tools/tests/run.sh
#
# Two kinds. The t-* files run the real endpoints against an in-memory store
# and check what actually comes back — money adding up, a doctor not being in
# two rooms at once, a photo coming back out of encryption unchanged. The
# wire* files check the joins: that every button has a handler, every call has
# a branch, every tab has a panel, every capability has a label.
#
# Nothing here touches the live clinic. It needs no keys and no network.
set -o pipefail   # not -u: an empty glob is a normal state, not an error
cd "$(dirname "$0")/../.." || exit 1
export DL_API="$PWD/api"
export STAFF_SECRET="${STAFF_SECRET:-local-test-secret}"
fail=0
shopt -s nullglob
behaviour=(tools/tests/t-*.js)
wiring=(tools/tests/wire*.js)

echo "── what the app does ──────────────────────────────"
[ ${#behaviour[@]} -eq 0 ] && echo "(none yet)"
for f in "${behaviour[@]}"; do
  out=$(node "$f" 2>&1); code=$?
  # A test that throws prints a stack trace and never reaches its own ✗ line.
  # Without the exit code, the runner printed "Node.js v26.7.0" as if it were a
  # verdict and called the run all good — t-whatsapp and t-photo sat dead that
  # way until 23 September 2026.
  if [ $code -ne 0 ] || echo "$out" | grep -qE "FAILURE|✗"; then
    fail=1; printf "%-14s FAILED\n" "$(basename "$f" .js)"
    echo "$out" | grep -E "✗|FAILURE|^[A-Za-z]*Error" | head -10 | sed 's/^/    /'
    [ $code -ne 0 ] && echo "$out" | tail -12 | sed 's/^/    /'
  else printf "%-14s %s\n" "$(basename "$f" .js)" "$(echo "$out" | tail -1)"; fi
done
echo
echo "── how it is wired together ───────────────────────"
[ ${#wiring[@]} -eq 0 ] && echo "(none yet)"
for f in "${wiring[@]}"; do
  full=$(node "$f" 2>&1); code=$?
  out=$(echo "$full" | tail -1)
  # A wiring check that finds something must fail the run, not just print a
  # quiet last line. This used to report "all good" over a staff.js that
  # could not load at all.
  if [ $code -ne 0 ] || echo "$full" | grep -qE "^ *✗|problem\(s\)|NOTHING GUARDS|SOMETHING IS BROKEN"; then
    fail=1; printf "%-14s FAILED\n" "$(basename "$f" .js)"; echo "$full" | grep -E "✗|problem" | head -20 | sed 's/^/    /'
  else printf "%-14s %s\n" "$(basename "$f" .js)" "$out"; fi
done
echo
[ $fail -eq 0 ] && echo "all good" || echo "SOMETHING IS BROKEN — see above"
exit $fail
