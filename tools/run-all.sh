#!/usr/bin/env bash
# One-command verification of every sparkline delivery artifact.
# Node suites run first (no browser needed); browser suites download and cache
# chrome-headless-shell on first use via tools/chrome.js.
set -euo pipefail
cd "$(dirname "$0")/.."

ART=artifacts/sparkline
mkdir -p "$ART"

echo "== 1/7 geometry invariants (500 random series x 3 widths) =="
node tools/test-geometry.js

echo "== 2/7 failure paths, Node (20 assertions + 3 tolerance) =="
node tools/test-failures.js

echo "== 3/7 resource / element upper bounds =="
node tools/test-bounds.js

echo "== 4/7 before/after fixture, same input =="
node tools/make-fixture.js

echo "== 5/7 browser: failures + lifecycle, widths, compare, legacy, edge, smoke =="
node tools/test-failures-browser.js
node tools/render-widths.js
node tools/compare.js
node tools/legacy-check.js
node tools/screenshot-edge.js
node tools/smoke.js

echo
echo "ALL SUITES PASSED — artifacts in $ART"
