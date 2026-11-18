#!/usr/bin/env bash
# One-stop verification for the local PDF exporter.
# Runs every check and leaves machine-readable reports under artifacts/deliverables.
set -euo pipefail
cd "$(dirname "$0")/.."

FONT=artifacts/fonts/wqy-zenhei.ttf
SCENE=artifacts/deliverables/smoke-fixed.svg
OUT=artifacts/deliverables
mkdir -p "$OUT"

echo "==> 1/6 TTF subsetter unit tests"
node tools/test-ttf-subset.js

echo "==> 2/7 failure-path / degradation tests"
node tools/test-failure-paths.js

echo "==> 3/7 real acgraph Stage integration (jsdom + vm)"
node tools/test-stage-integration.js

echo "==> 4/7 build sample PDF (mixed CJK+Latin, transparency, gradient)"
PDF_WIDTH=600 PDF_HEIGHT=400 node tools/run-convert.js "$SCENE" "$OUT/smoke.pdf" "$FONT" \
  | tee "$OUT/export-diagnostics.json"

echo "==> 5/7 structural + text-extraction verification (pypdf and MuPDF)"
python3 -I tools/verify-pdf.py "$OUT/smoke.pdf" artifacts/deliverables/source-lines.txt "$OUT/smoke-render.png" \
  | tee "$OUT/verify-report.json"

echo "==> 6/7 independent rasterization and pixel comparison"
node tools/rasterize-svg.js artifacts/deliverables/smoke-solid.svg "$OUT/smoke-solid-svg.png" 1200
PDF_WIDTH=600 PDF_HEIGHT=400 node tools/run-convert.js artifacts/deliverables/smoke-solid.svg \
  "$OUT/smoke-solid.pdf" "$FONT" >/dev/null
python3 -I -c "
import sys; sys.path.insert(0,'/home/ys/.local/lib/python3.12/site-packages')
import pymupdf
pymupdf.open('$OUT/smoke-solid.pdf')[0].get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False).save('$OUT/smoke-solid-pdf.png')
"
python3 -I tools/compare-pixels.py "$OUT/smoke-solid-svg.png" "$OUT/smoke-solid-pdf.png" \
  "$OUT/pixel-comparison-solid.json" >/dev/null

echo "==> 7/7 legacy path byte/structural regression and memory bounds"
node tools/verify-legacy-payload.js > "$OUT/legacy-payload-regression.json"
node --expose-gc tools/measure-bounds.js > "$OUT/memory-bounds.log"
tail -1 "$OUT/memory-bounds.log" >/dev/null

echo
echo "All verification stages completed. Reports in $OUT/"
