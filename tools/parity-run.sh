#!/bin/sh
# Walk every page in the original one-file app and in this port, each against
# its own fresh backend on the same data, and compare what each page rendered
# (element count, text length). A page that differs is measured again in both,
# with a long settle, so a slow load is not reported as a difference.
set -e
OUT=${TMPDIR:-/tmp}/fe-parity; mkdir -p "$OUT"
ORIG="file://$(cd "$(dirname "$0")/.." && pwd)/$(node -p "require('./tools/port-plan.json').source")"
npx vite build >/dev/null
walk() { # $1 = port|orig, $2 = output, $3 = pages (optional), $4 = settle ms
    if [ "$1" = orig ]; then URL="$ORIG"; else URL=; fi
    FE_SMOKE_URL="$URL" FE_SMOKE_PAGES="$3" FE_SMOKE_WAIT="$4" FE_SMOKE_SHAPES="$2" npx electron . --smoke | grep 'smoke:'
}
walk port "$OUT/port.json" "" 1200
walk orig "$OUT/orig.json" "" 1200
DIFF=$(node -e "const a=require('$OUT/orig.json'),b=require('$OUT/port.json');console.log(Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).join(','))")
if [ -n "$DIFF" ]; then
    echo "re-measuring with a 10 s settle: $DIFF"
    walk port "$OUT/port2.json" "$DIFF" 10000
    walk orig "$OUT/orig2.json" "$DIFF" 10000
fi
node -e "
const fs = require('fs'), O = '$OUT';
const a = require(O + '/orig.json'), b = require(O + '/port.json');
if (fs.existsSync(O + '/orig2.json') && '$DIFF') { Object.assign(a, require(O + '/orig2.json')); Object.assign(b, require(O + '/port2.json')); }
const diff = Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
for (const k of diff) console.log(k.padEnd(16), 'original', JSON.stringify(a[k]), 'port', JSON.stringify(b[k]));
console.log('parity: ' + (Object.keys(a).length - diff.length) + '/' + Object.keys(a).length + ' pages render the same as the original');
process.exit(diff.length ? 1 : 0);"
