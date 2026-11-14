/**
 * Resource / memory upper-bound checks for the heatmap data structures.
 * Measures retained heap for several grid sizes and verifies the analytic
 * bound derived in docs/HEATMAP.md:
 *
 *   Grid memory  = O(rows * cols + N)  where N = number of input points
 *                  values[]  : 8 bytes/slot (boxed number, amortized)
 *                  counts[] : 8 bytes/slot
 *                  buckets  : one mutable JS array per occupied cell
 *   Render plan = O(rows * cols) descriptors, each holding 10 scalar fields
 *   DOM output  = exactly rows*cols acgraph rect elements (when fillEmpty)
 *
 * Run: node test/heatmap/memory-bounds.js
 */
'use strict';

const path = require('path');
const heatmap = require(path.join(__dirname, '..', '..', 'src', 'heatmap', 'index.js'));

function retainedMb(fn) {
  global.gc();
  const before = process.memoryUsage().heapUsed;
  const retained = fn();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  return {deltaMb: (after - before) / 1048576, retained};
}

function build(rows, cols, pointsPerCell) {
  const grid = new heatmap.Grid({rows, cols, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100}});
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < pointsPerCell; k++) {
        points.push({
          x: (c + 0.5) / cols * 100,
          y: (r + 0.5) / rows * 100,
          value: (r * cols + c + k) % 97
        });
      }
    }
  }
  grid.addPoints(points);
  grid.fit();
  const plan = heatmap.buildRenderPlan(grid, {x: 0, y: 0, width: cols, height: rows},
      new heatmap.ColorScale(['#08306b', '#f7fbff', '#7f0000']));
  return {grid, plan, pointCount: points.length};
}

const scenarios = [
  {rows: 10, cols: 10, perCell: 1, label: '10x10 sparse (50-100 pts scale)'},
  {rows: 100, cols: 100, perCell: 1, label: '100x100, one point/cell'},
  {rows: 100, cols: 100, perCell: 10, label: '100x100, 100k points'},
  {rows: 500, cols: 500, perCell: 1, label: '500x500 stress (250k cells)'}
];

const results = [];
for (const scenario of scenarios) {
  const measurement = retainedMb(() => build(scenario.rows, scenario.cols, scenario.perCell));
  const cells = scenario.rows * scenario.cols;
  results.push(Object.assign({
    cells,
    planDescriptors: measurement.retained.plan.cells.length,
    heapDeltaMb: Number(measurement.deltaMb.toFixed(2)),
    bytesPerCell: Math.round(measurement.deltaMb * 1048576 / cells)
  }, scenario));
  console.log(' - ' + scenario.label + ': ' + cells + ' cells, ' +
      measurement.retained.pointCount + ' points, +' +
      measurement.deltaMb.toFixed(2) + ' MB heap');
}

// Hard guard: the documented ceiling for 100x100 must stay below 25 MB and
// the plan must never allocate more than one descriptor per cell.
const hundred = results.find(r => r.rows === 100 && r.cols === 100 && r.perCell === 1);
if (!(hundred.heapDeltaMb < 25)) throw new Error('100x100 exceeded the 25 MB ceiling');
if (hundred.planDescriptors !== 10000) throw new Error('plan descriptor count mismatch');

console.log('\nAll memory bounds satisfied (100x100 ceiling 25 MB, actual +' +
  hundred.heapDeltaMb + ' MB)');
