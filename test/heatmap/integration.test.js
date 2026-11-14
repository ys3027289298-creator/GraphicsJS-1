/**
 * Integration tests running the real, unmodified dist/graphics.js in jsdom:
 *  - heatmap renders through acgraph rect primitives
 *  - existing primitives produce byte-identical SVG across independent runs
 *  - render plans rasterize to deterministic PNGs, identical colors on zoom
 *  - empty / all-zero datasets never render black pixels
 *
 * Run: node test/heatmap/integration.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const harness = require('./harness');

const heatmap = require(path.join(harness.REPO_ROOT, 'src', 'heatmap', 'index.js'));
const ARTIFACT_DIR = path.join(harness.REPO_ROOT, 'artifacts', 'heatmap');
fs.mkdirSync(ARTIFACT_DIR, {recursive: true});

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

/** Deterministic sample dataset shared by every scenario in this suite. */
function samplePoints() {
  const points = [];
  let seed = 42;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  for (let i = 0; i < 200; i++) {
    points.push({
      x: Math.round(rand() * 1000) / 10,
      y: Math.round(rand() * 1000) / 10,
      value: Math.round(rand() * 100)
    });
  }
  return points;
}

// ------------------------------------------------- existing behavior unchanged
test('Existing chart primitives serialize byte-identically across fresh runs', () => {
  function draw() {
    const {acgraph, document, window} = harness.bootGraphics();
    const stage = acgraph.create(document.getElementById('container'), 320, 240);
    stage.rect(10, 20, 50, 60).fill('red').stroke('blue', 2);
    stage.circle(100, 100, 25).fill('#00ff00 0.5');
    stage.ellipse(200, 80, 30, 15).fill('rgb(10,20,30)');
    const layer = stage.layer();
    layer.path().moveTo(0, 0).lineTo(40, 40).lineTo(40, 0).close().fill('yellow');
    stage.text(10, 200, 'legacy text').fontSize('12px');
    return harness.normalizeSvgIds(harness.svgString(window, document));
  }
  const runA = draw();
  const runB = draw();
  assert.strictEqual(runA, runB);
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'legacy-primitives.svg'), runA);
});

test('Heatmap code does not alter the acgraph namespace surface', () => {
  const before = harness.bootGraphics();
  const baselineNames = Object.keys(before.acgraph).sort().join(',');
  // heatmap modules attach under acgraph.heatmap only; core keys stay intact
  require(path.join(harness.REPO_ROOT, 'src', 'heatmap', 'index.js'));
  const afterNames = Object.keys(before.acgraph).sort().join(',');
  assert.strictEqual(baselineNames, afterNames);
  assert.strictEqual(typeof heatmap.create, 'function');
});

// ------------------------------------------------------------- SVG rendering
test('Heatmap renders one SVG rect per cell including sparse empty cells', () => {
  const {acgraph, document, window} = harness.bootGraphics();
  const stage = acgraph.create(document.getElementById('container'), 200, 200);
  const hm = heatmap.create({
    rows: 10, cols: 10,
    bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
    colorStops: ['#08306b', '#f7fbff', '#7f0000'],
    emptyColor: '#e8e8e8'
  });
  hm.setData(samplePoints().slice(0, 50));
  hm.setView({x: 0, y: 0, width: 200, height: 200});
  hm.renderTo(stage);
  const svg = harness.normalizeSvgIds(harness.svgString(window, document));
  const rectCount = (svg.match(/<path /g) || []).length;
  assert.strictEqual(rectCount, 100, 'all 100 cells present, no holes');
  assert.ok(svg.includes('#e8e8e8'), 'empty cells use the explicit empty color');
  assert.ok(!svg.includes('rgb(0,0,0)'), 'no black fallback cells');
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'sparse-10x10.svg'), svg);
});

test('100x100 dense grid renders 10000 cells with derived domain', () => {
  const {acgraph, document, window} = harness.bootGraphics();
  const stage = acgraph.create(document.getElementById('container'), 500, 500);
  const hm = heatmap.create({
    rows: 100, cols: 100,
    bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
    aggregation: 'sum'
  });
  hm.setData(samplePoints());
  hm.setView({x: 0, y: 0, width: 500, height: 500});
  const plan = hm.getRenderPlan();
  assert.strictEqual(plan.cells.length, 10000);
  hm.renderTo(stage);
  const svg = harness.normalizeSvgIds(harness.svgString(window, document));
  assert.strictEqual((svg.match(/<path /g) || []).length, 10000);
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'dense-100x100.svg'), svg);
});

// ------------------------------------------------------------- zoom stability
test('Zoom changes geometry only: fill colors are byte-identical at 200px vs 400px', () => {
  const hm = heatmap.create({
    rows: 10, cols: 10,
    bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
    colorStops: ['#08306b', '#f7fbff', '#7f0000']
  });
  hm.setData(samplePoints().slice(0, 50));
  hm.setView({x: 0, y: 0, width: 200, height: 200});
  const small = hm.getRenderPlan();
  hm.setView({x: 0, y: 0, width: 400, height: 400});
  const large = hm.getRenderPlan();
  const smallColors = small.cells.map(c => c.color);
  const largeColors = large.cells.map(c => c.color);
  assert.deepStrictEqual(largeColors, smallColors);
  assert.strictEqual(large.cellWidth, 2 * small.cellWidth);
});

test('Same plan rasterizes identically twice (pixel-level determinism)', () => {
  const hm = heatmap.create({rows: 10, cols: 10, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100}});
  hm.setData(samplePoints().slice(0, 50));
  hm.setView({x: 0, y: 0, width: 100, height: 100});
  const plan = hm.getRenderPlan();
  const a = harness.rasterizePlan(plan);
  const b = harness.rasterizePlan(plan);
  assert.deepStrictEqual(Buffer.compare(a.rgba, b.rgba), 0);
});

// ------------------------------------------------------------- special states
test('No-data heatmap renders the explicit no-data color, never black', () => {
  const hm = heatmap.create({
    rows: 4, cols: 4, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
    noDataColor: '#f5f5f5'
  });
  hm.setData([]);
  hm.setView({x: 0, y: 0, width: 40, height: 40});
  const plan = hm.getRenderPlan();
  assert.strictEqual(plan.state, 'no-data');
  const image = harness.rasterizePlan(plan);
  for (let i = 0; i < image.rgba.length; i += 4) {
    assert.ok(!(image.rgba[i] === 0 && image.rgba[i + 1] === 0 && image.rgba[i + 2] === 0));
    assert.strictEqual(image.rgba[i], 0xf5);
  }
});

test('All-zero heatmap pins every occupied cell to the low end of the scale', () => {
  const hm = heatmap.create({
    rows: 4, cols: 4, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
    colorStops: ['#102030', '#ff0000']
  });
  hm.setData([{x: 10, y: 10, value: 0}, {x: 90, y: 90, value: 0}]);
  hm.setView({x: 0, y: 0, width: 40, height: 40});
  const plan = hm.getRenderPlan();
  assert.strictEqual(plan.state, 'zero-span');
  const occupied = plan.cells.filter(c => !c.empty);
  assert.ok(occupied.length >= 1);
  occupied.forEach(cell => assert.strictEqual(cell.color, 'rgb(16,32,48)'));
});

console.log('\n' + passed + ' integration tests passed\n');
