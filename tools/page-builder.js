'use strict';
/**
 * Builds self-contained test HTML: dist/graphics.js plus the two sparkline
 * modules inlined, so pages work over setContent() with no file server.
 * Test body markup/scripts are appended by each caller.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const GRAPHICS_JS = read('dist/graphics.js');
const CORE_JS = read('src/sparkline/sparkline-core.js');
const RENDER_JS = read('src/sparkline/sparkline.js');

function page(title, bodyHtml, testJs, opts = {}) {
  const bg = opts.background || '#fcfcfb';
  const transparent = opts.transparent ? 'background:transparent;' : `background:${bg};`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  html,body { margin:0; padding:0; ${transparent} font-family: -apple-system, "Segoe UI", sans-serif; }
  .cell { display:inline-block; margin:6px; vertical-align:middle; }
  table { border-collapse: collapse; margin:12px; }
  th, td { border:1px solid #d8d6cf; padding:6px 10px; font-size:12px; color:#0b0b0b; }
  th { background:#f2f1ec; text-align:left; }
  #probe-output { font: 11px/1.5 monospace; white-space:pre-wrap; margin:12px; }
  .pass { color:#0a7d3c; } .fail { color:#c62828; }
</style>
<script>var CLOSURE_NO_DEPS = true;</script>
<script>${GRAPHICS_JS}</script>
<script>${CORE_JS}</script>
<script>${RENDER_JS}</script>
</head><body>
${bodyHtml}
<script>
${testJs}
</script>
</body></html>`;
}

module.exports = {page, GRAPHICS_JS, CORE_JS, RENDER_JS, ROOT};
