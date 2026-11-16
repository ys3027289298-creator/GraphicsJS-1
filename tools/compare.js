#!/usr/bin/env node
/**
 * Before/after pixel comparison on the SAME input.
 *
 * before: a hand-written acgraph polyline replicating the legacy geometry from
 *         make-fixture.js (padding 2, all 12 points direct-mapped, no axis).
 * after:  acgraph.sparkline.create() with identical data and size.
 *
 * Produces before-<w>.png, after-<w>.png, diff-<w>.png (red = ink only in
 * after, cyan = ink only in before, gray = anti-aliased positions present in
 * both but not identical) and raw channel + pixelmatch statistics.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const {launch} = require('./chrome');
const {page} = require('./page-builder');

const OUT = path.join(__dirname, '..', 'artifacts', 'sparkline');
const DATA = [3, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15];
const WIDTHS = [24, 40, 120];
const HEIGHT = 24;

const LEGACY_JS = `
function renderLegacy(id, data, width, height) {
  const stage = acgraph.create(id, width, height);
  const layer = stage.layer();
  const pad = 2;
  const min = Math.min.apply(null, data), max = Math.max.apply(null, data);
  const p = layer.path();
  data.forEach(function (v, i) {
    const x = pad + (i / (data.length - 1)) * (width - 2 * pad);
    const y = (height - pad) - ((v - min) / (max - min)) * (height - 2 * pad);
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  });
  p.stroke('#2a78d6', 1.25).fill(null);
  return stage;
}
`;

function buildHtml(kind, width) {
  const body = `<div id="c"></div>`;
  const js = LEGACY_JS + `
  const DATA = ${JSON.stringify(DATA)};
  if (${kind === 'before'}) {
    renderLegacy('c', DATA, ${width}, ${HEIGHT});
  } else {
    acgraph.sparkline.create('c', DATA, {width:${width}, height:${HEIGHT}});
  }`;
  return page(`compare-${kind}-${width}`, body, js, {transparent: true});
}

function inkPixels(png) {
  let n = 0;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 0) n++;
  return n;
}

/** Diff heat map: red=after-only, cyan=before-only, yellow=both-but-different. */
function heatmap(a, b) {
  const out = new PNG({width: a.width, height: a.height});
  let rawChannelDiffs = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const same = a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] &&
      a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3];
    const aInk = a.data[i + 3] > 0, bInk = b.data[i + 3] > 0;
    if (same) {
      out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; out.data[i + 3] = 255;
    } else {
      for (let k = 0; k < 4; k++) if (a.data[i + k] !== b.data[i + k]) rawChannelDiffs++;
      if (bInk && !aInk) { // after-only
        out.data[i] = 227; out.data[i + 1] = 73; out.data[i + 2] = 72;
      } else if (aInk && !bInk) { // before-only
        out.data[i] = 27; out.data[i + 1] = 175; out.data[i + 2] = 122;
      } else { // both ink, different AA values
        out.data[i] = 128; out.data[i + 1] = 128; out.data[i + 2] = 128;
      }
      out.data[i + 3] = 255;
    }
  }
  return {png: out, rawChannelDiffs};
}

async function main() {
  const browser = await launch();
  const stats = [];
  try {
    for (const width of WIDTHS) {
      const shots = {};
      for (const kind of ['before', 'after']) {
        const pg = await browser.newPage();
        await pg.setViewport({width: width + 20, height: HEIGHT + 20, deviceScaleFactor: 2});
        await pg.setContent(buildHtml(kind, width), {waitUntil: 'networkidle0'});
        const file = path.join(OUT, `${kind}-${width}.png`);
        await (await pg.$('#c')).screenshot({path: file, omitBackground: true});
        shots[kind] = PNG.sync.read(fs.readFileSync(file));
        await pg.close();
      }
      const a = shots.before, b = shots.after;
      const pm = pixelmatch(a.data, b.data, null, a.width, a.height,
        {threshold: 0.1, includeAA: true});
      const heat = heatmap(a, b);
      fs.writeFileSync(path.join(OUT, `diff-${width}.png`), PNG.sync.write(heat.png));
      let diffPixels = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] ||
          a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) diffPixels++;
      }
      stats.push({
        width,
        imageSize: [a.width, a.height],
        beforeInk: inkPixels(a),
        afterInk: inkPixels(b),
        diffPixels,
        diffPercent: +(100 * diffPixels / (a.width * a.height)).toFixed(3),
        pixelmatchDiff: pm,
        rawChannelDiffs: heat.rawChannelDiffs,
        shots: [`before-${width}.png`, `after-${width}.png`, `diff-${width}.png`]
      });
    }
  } finally {
    await browser.close();
  }
  const report = {generatedAt: new Date().toISOString(), pixelmatchOptions:
    {threshold: 0.1, includeAA: true}, rows: stats};
  fs.writeFileSync(path.join(OUT, 'compare-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
