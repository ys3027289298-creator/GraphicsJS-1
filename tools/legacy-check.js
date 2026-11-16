#!/usr/bin/env node
/**
 * Legacy behavior consistency proof.
 *
 * The feature is purely additive: no existing src/ or dist/ file is edited.
 * To prove that empirically, the SAME traditional drawing code runs twice:
 *   before: page loads only dist/graphics.js
 *   after:  page loads dist/graphics.js + both sparkline modules
 * We then compare (a) serialized SVG after normalizing only the randomized
 * acgraph instance ids, and (b) every PNG pixel, AA included, plus raw RGBA
 * channel bytes. All three must be identical.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const {launch} = require('./chrome');
const {GRAPHICS_JS, CORE_JS, RENDER_JS} = require('./page-builder');

const OUT = path.join(__dirname, '..', 'artifacts', 'sparkline');
const SHAPE_JS = `
function drawLegacyShapes() {
  const stage = acgraph.create('stage', 320, 120);
  const layer = stage.layer();
  layer.rect(10, 10, 60, 40).fill('#2a78d6', 0.35).stroke('#0b0b0b', 1.5);
  layer.circle(130, 30, 22).fill('#e34948').stroke('#ffffff', 1);
  layer.ellipse(210, 30, 34, 20).fill('#1baf7a').stroke(null);
  const p = layer.path();
  p.moveTo(10, 100).lineTo(60, 70).lineTo(110, 95).lineTo(160, 60).lineTo(220, 100);
  p.stroke({color:'#6250d6', dash:'4 3', lineCap:'round'}, 2).fill(null);
  const p2 = layer.path();
  p2.moveTo(240, 110).lineTo(300, 70).lineTo(310, 110).close();
  p2.fill('#eda100', 0.8).stroke('#0b0b0b', 1);
  const t = stage.text(10, 112, 'legacy text 0123');
  t.fontSize('11px').color('#52514e');
  return stage;
}
`;

function html(withSparkline) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fcfcfb;}</style>
<script>var CLOSURE_NO_DEPS = true;</script>
<script>${GRAPHICS_JS}</script>
${withSparkline ? `<script>${CORE_JS}</script><script>${RENDER_JS}</script>` : ''}
</head><body><div id="stage"></div>
<script>${SHAPE_JS}
drawLegacyShapes();
window.__svg = document.getElementById('stage').innerHTML;
</script></body></html>`;
}

// acgraph generates ids like ac_svg_<hash>_<n>; normalize every token so only
// structural/attribute differences remain.
function normalizeIds(svg) {
  return svg.replace(/ac_[a-z]+_[0-9a-fA-F]+_\d+/g, 'ac_ID')
            .replace(/ac_[a-z]+_\d+/g, 'ac_ID');
}

async function shoot(browser, withSparkline, file) {
  const pg = await browser.newPage();
  await pg.setViewport({width: 340, height: 140, deviceScaleFactor: 2});
  await pg.setContent(html(withSparkline), {waitUntil: 'networkidle0'});
  const svg = await pg.evaluate(() => window.__svg);
  await (await pg.$('#stage')).screenshot({path: file});
  await pg.close();
  return svg;
}

async function main() {
  const browser = await launch();
  try {
    const beforeSvgRaw = await shoot(browser, false, path.join(OUT, 'legacy-before.png'));
    const afterSvgRaw = await shoot(browser, true, path.join(OUT, 'legacy-after.png'));
    const beforeSvg = normalizeIds(beforeSvgRaw);
    const afterSvg = normalizeIds(afterSvgRaw);
    const svgByteIdentical = beforeSvg === afterSvg;

    const a = PNG.sync.read(fs.readFileSync(path.join(OUT, 'legacy-before.png')));
    const b = PNG.sync.read(fs.readFileSync(path.join(OUT, 'legacy-after.png')));
    const pm = pixelmatch(a.data, b.data, null, a.width, a.height,
      {threshold: 0, includeAA: true});
    let rawChannelDiffs = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) rawChannelDiffs++;

    // Diff heat map (all-white when pixel perfect).
    const diff = new PNG({width: a.width, height: a.height});
    for (let i = 0; i < a.data.length; i += 4) {
      const same = a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] &&
        a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3];
      diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = same ? 255 : 227;
      diff.data[i + 3] = same ? 255 : (same ? 255 : 255);
      if (!same) { diff.data[i] = 227; diff.data[i + 1] = 73; diff.data[i + 2] = 72; diff.data[i + 3] = 255; }
    }
    fs.writeFileSync(path.join(OUT, 'legacy-diff.png'), PNG.sync.write(diff));

    const report = {
      generatedAt: new Date().toISOString(),
      svgByteIdentical,
      svgLength: beforeSvg.length,
      svgLengthsMatch: beforeSvg.length === afterSvg.length,
      screenshotSize: [a.width, a.height],
      pixelMismatches: pm,
      totalPixels: a.width * a.height,
      rawChannelDiffs,
      pixelPerfect: pm === 0 && rawChannelDiffs === 0
    };
    fs.writeFileSync(path.join(OUT, 'legacy-consistency.json'),
      JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (!report.svgByteIdentical || !report.pixelPerfect) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
