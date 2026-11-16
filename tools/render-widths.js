#!/usr/bin/env node
/**
 * Renders the fixed 12-point series at 24px and 40px, saves native DSF=2
 * screenshots and 8x nearest-neighbor upscales, and records the slot
 * compression statistics from the live renderer layout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;
const {launch} = require('./chrome');
const {page} = require('./page-builder');

const OUT = path.join(__dirname, '..', 'artifacts', 'sparkline');
const DATA = [3, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15];
const HEIGHT = 24;

function nearestNeighbor(srcPng, factor) {
  const out = new PNG({width: srcPng.width * factor, height: srcPng.height * factor});
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const sx = Math.floor(x / factor), sy = Math.floor(y / factor);
      const si = (sy * srcPng.width + sx) * 4;
      const di = (y * out.width + x) * 4;
      out.data[di] = srcPng.data[si];
      out.data[di + 1] = srcPng.data[si + 1];
      out.data[di + 2] = srcPng.data[si + 2];
      out.data[di + 3] = srcPng.data[si + 3];
    }
  }
  return out;
}

async function main() {
  const browser = await launch();
  const rows = [];
  try {
    for (const width of [24, 40]) {
      const html = page(`width-${width}`,
        `<div id="c" class="cell"></div>`,
        `window.__spark = acgraph.sparkline.create('c', ${JSON.stringify(DATA)},
           {width:${width}, height:${HEIGHT}});
         window.__layout = window.__spark.getLayout();`);
      const pg = await browser.newPage();
      await pg.setViewport({width: 120, height: 80, deviceScaleFactor: 2});
      await pg.setContent(html, {waitUntil: 'networkidle0'});
      const el = await pg.$('#c');
      const nativePath = path.join(OUT, `s${width}-native.png`);
      await el.screenshot({path: nativePath});
      const layout = await pg.evaluate(() => window.__layout);

      const src = PNG.sync.read(fs.readFileSync(nativePath));
      const up = nearestNeighbor(src, 8);
      fs.writeFileSync(path.join(OUT, `s${width}-8x.png`), PNG.sync.write(up));

      const gaps = layout.rendered.slice(1).map((p, i) => p.x - layout.rendered[i].x);
      rows.push({
        width,
        capacity: layout.capacity,
        inputPoints: layout.inputLength,
        renderedPoints: layout.rendered.length,
        decimated: layout.decimated,
        renderedIndices: layout.rendered.map(p => p.index),
        minAdjacentXGapPx: gaps.length ? Math.min.apply(null, gaps) : null,
        nativeShot: `s${width}-native.png`,
        upscaledShot: `s${width}-8x.png`
      });
      await pg.close();
    }
  } finally {
    await browser.close();
  }
  const report = {generatedAt: new Date().toISOString(), rows};
  fs.writeFileSync(path.join(OUT, 'widths-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
