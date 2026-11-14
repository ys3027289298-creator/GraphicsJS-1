/**
 * Before/after comparison on ONE fixed input:
 *  - before: the only previously available view, a scatter plot drawn with
 *            acgraph circles
 *  - after:  grid-aggregated heatmap over the same points
 * Emits both SVG renders and a numeric comparison report.
 *
 * Run: node test/heatmap/before-after.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const harness = require('./harness');
const heatmap = require(path.join(harness.REPO_ROOT, 'src', 'heatmap', 'index.js'));

const OUT = path.join(harness.REPO_ROOT, 'artifacts', 'heatmap');
fs.mkdirSync(OUT, {recursive: true});

// Single deterministic input reused by the scatter and the heatmap.
const input = JSON.parse(fs.readFileSync(path.join(OUT, 'sparse-input.json'), 'utf8'));
const VIEW = {x: 20, y: 20, width: 200, height: 200};
const BOUNDS = {minX: 0, minY: 0, maxX: 100, maxY: 100};

function project(point) {
  return {
    cx: VIEW.x + (point.x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX) * VIEW.width,
    cy: VIEW.y + (point.y - BOUNDS.minY) / (BOUNDS.maxY - BOUNDS.minY) * VIEW.height,
    value: point.value
  };
}

// --------------------------------------------------------------- before: dots
{
  const {acgraph, document, window} = harness.bootGraphics();
  const stage = acgraph.create(document.getElementById('container'), 240, 240);
  input.forEach(point => {
    const p = project(point);
    stage.circle(p.cx, p.cy, 3).fill('#3366cc').stroke(null);
  });
  const svg = harness.normalizeSvgIds(harness.svgString(window, document));
  fs.writeFileSync(path.join(OUT, 'before-scatter.svg'), svg);
}

// --------------------------------------------------------------- after: heat
let plan;
{
  const {acgraph, document, window} = harness.bootGraphics();
  const stage = acgraph.create(document.getElementById('container'), 240, 240);
  const hm = heatmap.create({
    rows: 10, cols: 10, bounds: BOUNDS, aggregation: 'sum',
    colorStops: ['#08306b', '#f7fbff', '#7f0000'], emptyColor: '#e8e8e8'
  });
  hm.setData(input);
  hm.setView(VIEW);
  plan = hm.getRenderPlan();
  hm.renderTo(stage);
  const svg = harness.normalizeSvgIds(harness.svgString(window, document));
  fs.writeFileSync(path.join(OUT, 'after-heatmap.svg'), svg);
}

// --------------------------------------------------------- numeric comparison
const occupied = plan.cells.filter(c => !c.empty);
const totals = input.reduce((acc, p) => acc + p.value, 0);
const cellTotal = occupied.reduce((acc, c) => acc + c.value, 0);
const report = {
  inputPoints: input.length,
  inputChecksum: totals,
  scatter: {
    primitives: 'one acgraph circle per point',
    elementCount: input.length,
    aggregation: 'none'
  },
  heatmap: {
    grid: '10x10',
    cellsEmitted: plan.cells.length,
    occupiedCells: occupied.length,
    emptyCells: plan.cells.length - occupied.length,
    aggregation: 'sum',
    aggregatedValueChecksum: cellTotal,
    checksumPreserved: cellTotal === totals,
    domain: plan.state === 'normal' ? undefined : undefined
  },
  perCell: occupied.map(c => ({
    row: c.row, col: c.col, value: c.value, t: Number(c.t.toFixed(6)), color: c.color
  })).sort((a, b) => a.row - b.row || a.col - b.col)
};
fs.writeFileSync(path.join(OUT, 'before-after-report.json'), JSON.stringify(report, null, 2));

// --------------------------------------------- side-by-side raster comparison
function blankRgba(width, height, rgb) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
const W = 240, H = 240;
// left panel: scatter dots
const scatterRgba = blankRgba(W, H, [255, 255, 255]);
input.forEach(point => {
  const p = project(point);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 9) continue;
      const x = Math.round(p.cx), y = Math.round(p.cy);
      const offset = ((y + dy) * W + (x + dx)) * 4;
      if (offset < 0 || offset >= scatterRgba.length) continue;
      scatterRgba[offset] = 0x33;
      scatterRgba[offset + 1] = 0x66;
      scatterRgba[offset + 2] = 0xcc;
    }
  }
});
// right panel: heatmap rasterization shifted onto the 240x240 stage
const heatRgba = blankRgba(W, H, [255, 255, 255]);
const heatImage = harness.rasterizePlan(plan);
for (let y = 0; y < heatImage.height; y++) {
  for (let x = 0; x < heatImage.width; x++) {
    const src = (y * heatImage.width + x) * 4;
    const dst = ((y + VIEW.y) * W + (x + VIEW.x)) * 4;
    heatRgba[dst] = heatImage.rgba[src];
    heatRgba[dst + 1] = heatImage.rgba[src + 1];
    heatRgba[dst + 2] = heatImage.rgba[src + 2];
  }
}
// stitch horizontally
const combined = Buffer.alloc(W * 2 * H * 4);
for (let y = 0; y < H; y++) {
  scatterRgba.copy(combined, y * W * 2 * 4, y * W * 4, (y + 1) * W * 4);
  heatRgba.copy(combined, y * W * 2 * 4 + W * 4, y * W * 4, (y + 1) * W * 4);
}
fs.writeFileSync(path.join(OUT, 'before-scatter.png'), harness.encodePng(W, H, scatterRgba));
fs.writeFileSync(path.join(OUT, 'after-heatmap.png'), harness.encodePng(W, H, heatRgba));
fs.writeFileSync(path.join(OUT, 'before-after-side-by-side.png'), harness.encodePng(W * 2, H, combined));
console.log(JSON.stringify({
  inputPoints: report.inputPoints,
  checksumPreserved: report.heatmap.checksumPreserved,
  occupiedCells: report.heatmap.occupiedCells,
  emptyCells: report.heatmap.emptyCells
}, null, 2));
