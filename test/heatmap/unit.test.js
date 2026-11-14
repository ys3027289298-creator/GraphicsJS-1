/**
 * Zero-dependency unit tests for the heatmap data-space logic.
 * Run: node test/heatmap/unit.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const heatmapRoot = path.join(__dirname, '..', '..', 'src', 'heatmap');
const ColorScale = require(path.join(heatmapRoot, 'colorScale.js'));
const Grid = require(path.join(heatmapRoot, 'grid.js'));
const heatmapNs = require(path.join(heatmapRoot, 'index.js'));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

function makeGrid(rows, cols, points, config) {
  const grid = new Grid(Object.assign({rows, cols, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100}}, config));
  grid.addPoints(points);
  grid.fit();
  return grid;
}

// ---------------------------------------------------------------- color scale
test('ColorScale interpolates piecewise linearly and clamps', () => {
  const scale = new ColorScale([{offset: 0, color: '#000000'}, {offset: 1, color: '#ffffff'}]);
  assert.deepStrictEqual(scale.rgbAt(0), [0, 0, 0]);
  assert.deepStrictEqual(scale.rgbAt(1), [255, 255, 255]);
  assert.deepStrictEqual(scale.rgbAt(0.5), [128, 128, 128]);
  assert.deepStrictEqual(scale.rgbAt(-2), [0, 0, 0]);
  assert.deepStrictEqual(scale.rgbAt(9), [255, 255, 255]);
  assert.strictEqual(scale.colorAt(0), 'rgb(0,0,0)');
});

test('ColorScale spreads bare colors evenly and supports rgb() strings', () => {
  const scale = new ColorScale(['#ff0000', 'rgb(0,255,0)']);
  assert.deepStrictEqual(scale.getStops().map(s => s.offset), [0, 1]);
  assert.deepStrictEqual(scale.rgbAt(0), [255, 0, 0]);
});

test('ColorScale rejects invalid definitions', () => {
  assert.throws(() => new ColorScale(['#ff0000']), /at least 2/);
  assert.throws(() => new ColorScale(['not-a-color', '#fff']), /Unsupported color/);
  assert.throws(() => new ColorScale([{offset: 2, color: '#fff'}, {offset: 0, color: '#000'}]), /\[0, 1\]/);
});

// ---------------------------------------------------------------- aggregation
test('Grid bins points with sum aggregation and stable indices', () => {
  const points = [
    {x: 5, y: 5, value: 3}, {x: 5, y: 5, value: 7},
    {x: 95, y: 95, value: 2}
  ];
  const grid = makeGrid(10, 10, points);
  assert.strictEqual(grid.pointCount, 3);
  assert.strictEqual(grid.occupiedCells(), 2);
  assert.strictEqual(grid.values[0], 10);            // row 0, col 0
  assert.strictEqual(grid.values[9 * 10 + 9], 2);     // row 9, col 9
  assert.strictEqual(grid.counts[0], 2);
  assert.deepStrictEqual(grid.domain, [2, 10]);
});

test('Boundary points land in the last bin instead of overflowing', () => {
  const grid = makeGrid(4, 4, [{x: 100, y: 100, value: 1}]);
  assert.strictEqual(grid.values[4 * 4 - 1], 1);
});

test('Degenerate single-point bounds do not divide by zero', () => {
  const grid = makeGrid(3, 3, [{x: 7, y: 7, value: 4}]);
  assert.strictEqual(grid.values[0], 4);
  assert.deepStrictEqual(grid.domain, [4, 4]);
  assert.strictEqual(grid.normalize(4), 0);
});

test('mean/count/min/max and custom reducers all work', () => {
  const pts = [{x: 1, y: 1, value: 2}, {x: 1, y: 1, value: 8}];
  assert.strictEqual(makeGrid(2, 2, pts, {aggregation: 'mean'}).values[0], 5);
  assert.strictEqual(makeGrid(2, 2, pts, {aggregation: 'count'}).values[0], 2);
  assert.strictEqual(makeGrid(2, 2, pts, {aggregation: 'min'}).values[0], 2);
  assert.strictEqual(makeGrid(2, 2, pts, {aggregation: 'max'}).values[0], 8);
  const custom = makeGrid(2, 2, pts, {aggregation: vals => vals[0] * 100});
  assert.strictEqual(custom.values[0], 200);
});

test('Explicit domain overrides derived domain and normalizes within it', () => {
  const grid = makeGrid(2, 2, [{x: 1, y: 1, value: 5}], {domain: [0, 10]});
  assert.deepStrictEqual(grid.domain, [0, 10]);
  assert.strictEqual(grid.normalize(5), 0.5);
  assert.strictEqual(grid.normalize(99), 1);
});

test('Sparse data: every cell gets a descriptor, empty ones flagged', () => {
  const grid = makeGrid(10, 10, [{x: 50, y: 50, value: 1}]);
  const descriptors = grid.cellDescriptors();
  assert.strictEqual(descriptors.length, 100);
  assert.strictEqual(descriptors.filter(d => d.empty).length, 99);
  const dense = new Grid({rows: 10, cols: 10, fillEmpty: false, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100}});
  dense.addPoints([{x: 50, y: 50, value: 1}]);
  dense.fit();
  assert.strictEqual(dense.cellDescriptors().length, 1);
});

test('No-data grid reports the zero domain and serializes all cells empty', () => {
  const grid = new Grid({rows: 3, cols: 3, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100}});
  grid.fit();
  assert.deepStrictEqual(grid.domain, [0, 0]);
  assert.strictEqual(grid.cellDescriptors().every(d => d.empty), true);
});

test('All-zero data resolves to zero-span domain, never NaN', () => {
  const grid = makeGrid(2, 2, [{x: 1, y: 1, value: 0}, {x: 90, y: 90, value: 0}]);
  assert.deepStrictEqual(grid.domain, [0, 0]);
  assert.strictEqual(grid.normalize(0), 0);
  assert.strictEqual(grid.cellDescriptors().some(d => Number.isNaN(d.t)), false);
});

// ---------------------------------------------------------------- render plan
test('Render plan colors are identical after zoom (geometry only changes)', () => {
  const points = [];
  for (let i = 0; i < 25; i++) {
    points.push({x: (i * 37) % 100, y: (i * 53) % 100, value: (i * 7) % 11});
  }
  const grid = makeGrid(10, 10, points);
  const scale = new ColorScale(['#0000ff', '#ff0000']);
  const small = heatmapNs.buildRenderPlan(grid, {x: 0, y: 0, width: 200, height: 200}, scale);
  const large = heatmapNs.buildRenderPlan(grid, {x: 0, y: 0, width: 400, height: 400}, scale);
  assert.strictEqual(small.cells.length, large.cells.length);
  for (let i = 0; i < small.cells.length; i++) {
    assert.strictEqual(small.cells[i].color, large.cells[i].color, 'cell ' + i + ' color drift');
    assert.strictEqual(small.cells[i].t, large.cells[i].t);
  }
  assert.strictEqual(large.cells[0].width, 2 * small.cells[0].width);
});

test('Empty cells use the configurable empty color, not black', () => {
  const grid = makeGrid(5, 5, [{x: 50, y: 50, value: 1}, {x: 10, y: 10, value: 4}]);
  const plan = heatmapNs.buildRenderPlan(grid, {x: 0, y: 0, width: 100, height: 100},
      new ColorScale(['#fff', '#000']), {emptyColor: 'rgb(230,230,230)'});
  const emptyCell = plan.cells.find(c => c.empty);
  assert.strictEqual(emptyCell.color, 'rgb(230,230,230)');
  assert.strictEqual(plan.state, 'normal');
});

test('No-data and zero-span plans get explicit, distinct states', () => {
  const noData = new Grid({rows: 2, cols: 2, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100}});
  noData.fit();
  const noDataPlan = heatmapNs.buildRenderPlan(noData, {x: 0, y: 0, width: 10, height: 10},
      new ColorScale(['#fff', '#000']));
  assert.strictEqual(noDataPlan.state, 'no-data');
  assert.ok(noDataPlan.cells.every(c => c.color === noDataPlan.noDataColor));

  const zeros = makeGrid(2, 2, [{x: 1, y: 1, value: 0}]);
  const zeroPlan = heatmapNs.buildRenderPlan(zeros, {x: 0, y: 0, width: 10, height: 10},
      new ColorScale(['#aabbcc', '#000000']));
  assert.strictEqual(zeroPlan.state, 'zero-span');
  assert.ok(zeroPlan.cells.every(c => c.empty || c.color === 'rgb(170,187,204)'));
});

test('Facade setData/setView/render plan lifecycle', () => {
  const heat = heatmapNs.create({rows: 4, cols: 4, bounds: {minX: 0, minY: 0, maxX: 10, maxY: 10}});
  heat.setData([{x: 1, y: 1, value: 3}]);
  assert.throws(() => heat.getRenderPlan(), /setView/);
  heat.setView({x: 0, y: 0, width: 40, height: 40});
  const plan = heat.getRenderPlan();
  assert.strictEqual(plan.cells.length, 16);
  assert.strictEqual(heat.getRenderPlan(), plan); // cached
  heat.setView({x: 0, y: 0, width: 80, height: 80});
  assert.notStrictEqual(heat.getRenderPlan(), plan);
});

// ---------------------------------------------------------------- failure paths
test('Validation errors are specific and reproducible', () => {
  assert.throws(() => new Grid({rows: 0, cols: 10}), /positive integers/);
  assert.throws(() => makeGrid(2, 2, [{x: 'a', y: 1}]), /finite numbers/);
  assert.throws(() => makeGrid(2, 2, [{x: 1, y: 1, value: NaN}]), /finite number/);
  assert.throws(() => makeGrid(2, 2, [{x: 1, y: 1}], {aggregation: 'median'}), /Unknown aggregation/);
  assert.throws(() => makeGrid(2, 2, [{x: 1, y: 1, value: 1}], {domain: [5, 1]}), /ordered/);
  const fitted = makeGrid(2, 2, [{x: 1, y: 1, value: 1}]);
  assert.throws(() => heatmapNs.buildRenderPlan(fitted, {x: 0, y: 0, width: 0, height: 10}, new ColorScale(['#fff', '#000'])),
      /positive width/);
});

console.log('\n' + passed + ' unit tests passed\n');
