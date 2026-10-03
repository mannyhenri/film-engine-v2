#!/bin/sh
# Walk every page in the original one-file app and in this port, against the
# same backend, and compare what each page rendered (element count, text length).
set -e
OUT=${TMPDIR:-/tmp}/fe-parity; mkdir -p "$OUT"
WAIT=${FE_SMOKE_WAIT:-4000}
npx vite build >/dev/null
FE_SMOKE_WAIT=$WAIT FE_SMOKE_SHAPES="$OUT/port.json" npx electron . --smoke | grep 'smoke:'
FE_SMOKE_WAIT=$WAIT FE_SMOKE_URL="file://$(cd ../film-engine/src && pwd)/index.html" FE_SMOKE_SHAPES="$OUT/orig.json" npx electron . --smoke | grep 'smoke:'
node -e "
const a = require('$OUT/orig.json'), b = require('$OUT/port.json');
const diff = Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
for (const k of diff) console.log(k.padEnd(16), 'original', JSON.stringify(a[k]), 'port', JSON.stringify(b[k]));
console.log('parity: ' + (Object.keys(a).length - diff.length) + '/' + Object.keys(a).length + ' pages render the same as the original');
process.exit(diff.length ? 1 : 0);"
