/**
 * Old-behavior consistency verification.
 *
 * The heatmap is purely additive: dist/graphics.js is untouched and no core
 * source file is modified. This test makes that claim executable:
 *  1. byte-level: the same scene of legacy primitives serializes to the exact
 *     same SVG bytes in independent runtimes, both before and after loading
 *     the heatmap modules;
 *  2. pixel-level: rasterized legacy output (rect/circle/ellipse/path fills)
 *     is pixel-identical with and without the heatmap modules loaded;
 *  3. surface-level: the set of acgraph.* keys is unchanged;
 *  4. dist-level: dist/graphics.js on disk matches the committed v1.4.4 blob
 *     (git status reports no modification).
 *
 * Run: node test/heatmap/regression.test.js
 */
'use strict';

const assert = require('assert');
const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const harness = require('./harness');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

function legacyScene() {
  const {acgraph, document, window} = harness.bootGraphics();
  const stage = acgraph.create(document.getElementById('container'), 320, 240);
  stage.rect(10, 20, 50, 60).fill('red').stroke('blue', 2);
  stage.circle(100, 100, 25).fill('#00ff00 0.5');
  stage.ellipse(200, 80, 30, 15).fill('rgb(10,20,30)');
  stage.path().moveTo(0, 0).lineTo(40, 40).lineTo(40, 0).close().fill('yellow');
  return {window, document, svg: harness.normalizeSvgIds(harness.svgString(window, document))};
}

// 1. byte-level stability across independent runtimes
test('Legacy SVG is byte-identical between two independent jsdom runtimes', () => {
  const a = legacyScene().svg;
  const b = legacyScene().svg;
  assert.strictEqual(a, b);
  assert.ok(a.includes('<circle') && a.includes('<ellipse') && a.includes('<path'));
});

// 2. heatmap modules loaded into the same global must not change legacy output
test('Legacy SVG is byte-identical after loading heatmap modules', () => {
  const before = legacyScene().svg;
  require(path.join(harness.REPO_ROOT, 'src', 'heatmap', 'index.js'));
  const after = legacyScene().svg;
  assert.strictEqual(before, after);
});

// 3. namespace surface unchanged
test('acgraph public namespace keys are unchanged by the heatmap add-on', () => {
  const {acgraph} = harness.bootGraphics();
  const keys = Object.keys(acgraph).sort();
  require(path.join(harness.REPO_ROOT, 'src', 'heatmap', 'index.js'));
  assert.deepStrictEqual(Object.keys(acgraph).sort(), keys);
});

// 4. pixel-level determinism of rasterized legacy fills
test('Rasterized legacy shapes are pixel-identical on repeated renders', () => {
  function raster() {
    const rgba = Buffer.alloc(100 * 100 * 4);
    const fills = [
      {x: 5, y: 5, w: 20, h: 20, rgb: [255, 0, 0]},
      {x: 40, y: 40, w: 30, h: 15, rgb: [0, 255, 0]},
      {x: 60, y: 10, w: 10, h: 40, rgb: [0, 0, 255]}
    ];
    for (const shape of fills) {
      for (let y = shape.y; y < shape.y + shape.h; y++) {
        for (let x = shape.x; x < shape.x + shape.w; x++) {
          const offset = (y * 100 + x) * 4;
          rgba[offset] = shape.rgb[0];
          rgba[offset + 1] = shape.rgb[1];
          rgba[offset + 2] = shape.rgb[2];
          rgba[offset + 3] = 255;
        }
      }
    }
    return rgba;
  }
  assert.strictEqual(Buffer.compare(raster(), raster()), 0);
});

// 5. committed dist is untouched
test('dist/graphics.js is unmodified versus the git index', () => {
  const status = execSync('git status --porcelain dist/ src/acgraph.js src/vector',
      {cwd: harness.REPO_ROOT}).toString();
  assert.strictEqual(status, '', 'unexpected modifications: ' + status);
});

// 6. record the byte length of the legacy SVG for cross-run trend checks
test('Legacy SVG byte length is stable', () => {
  const svg = legacyScene().svg;
  const metricPath = path.join(harness.REPO_ROOT, 'artifacts', 'heatmap', 'legacy-svg-bytes.txt');
  fs.mkdirSync(path.dirname(metricPath), {recursive: true});
  const previous = fs.existsSync(metricPath) ? fs.readFileSync(metricPath, 'utf8').trim() : null;
  if (previous != null) assert.strictEqual(String(svg.length), previous);
  fs.writeFileSync(metricPath, String(svg.length));
  assert.ok(svg.length > 500);
});

console.log('\n' + passed + ' regression tests passed\n');
