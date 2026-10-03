#!/bin/sh
# The backend suite, one file per process, 3 at a time (the ffmpeg tests time
# out under heavier parallel load). Prints a line per file and a total.
cd "$(dirname "$0")/../backend" || exit 1
OUT=${TMPDIR:-/tmp}/fe-backend-tests; rm -rf "$OUT"; mkdir -p "$OUT"
export OUT
ls tests/*.test.js | xargs -P 3 -I{} sh -c 'f={}; log="$OUT/$(basename "$f").log"; if node --test "$f" > "$log" 2>&1; then echo "PASS $f"; else echo "FAIL $f :: $(grep -m1 -E "Error|expected" "$log" | tr -s " " | cut -c1-160)"; fi' | tee "$OUT/summary.txt"
total=$(wc -l < "$OUT/summary.txt" | tr -d ' '); failed=$(grep -c '^FAIL' "$OUT/summary.txt")
echo "backend: $((total - failed))/$total test files pass (logs in $OUT)"
[ "$failed" -eq 0 ]
