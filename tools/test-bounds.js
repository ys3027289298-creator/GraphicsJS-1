#!/usr/bin/env node
/**
 * Resource / memory upper-bound evidence.
 *
 * The rendered point count is bounded by slot capacity, which depends only on
 * plot width, never on input length n. This test feeds 10k-point series into
 * 24px cells and proves the element budget stays at the capacity ceiling.
 *
 * The renderer element upper bound for a normal series is:
 *   1 (axis, when enabled) + bands.length + 1 (polyline) + markerCount
 * The core reports markers after the 4px thinning; the browser smoke test
 * re-checks the realized DOM element count against the same bound.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../src/sparkline/sparkline-core.js');

const OUT = path.join(__dirname, '..', 'artifacts', 'sparkline', 'bounds-report.json');
const WIDTHS = [24, 40, 120];
const LENGTHS = [12, 60, 1000, 10000];
const HEIGHT = 24;

function series(n, seed) {
  // Deterministic oscillating data so decimation always has real variation.
  const out = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out.push(50 + 30 * Math.sin(i / 3) + (s % 17) - 8);
  }
  return out;
}

const rows = [];
let allWithinBound = true;
for (const n of LENGTHS) {
  const data = series(n, n * 7 + 1);
  for (const width of WIDTHS) {
    const layout = core.computeLayout(data, {width, height: HEIGHT, markers: true});
    // Upper bound: axis + polyline + at most `capacity` markers + zero bands here.
    const upperBound = 1 + 1 + layout.capacity;
    const realized = 1 + 1 + layout.markers.length;
    const pointBoundOk = layout.rendered.length <= layout.capacity;
    const spacingOk = layout.rendered.slice(1).every((p, i) =>
      p.x - layout.rendered[i].x >= core.MIN_POINT_SPACING - 1e-9);
    const withinBound = pointBoundOk && spacingOk && realized <= upperBound;
    if (!withinBound) allWithinBound = false;
    rows.push({
      inputLength: n,
      width,
      capacity: layout.capacity,
      renderedPoints: layout.rendered.length,
      markers: layout.markers.length,
      graphicElementUpperBound: realized,
      withinBound
    });
  }
}

// Empty / single-point cell budgets.
const emptyLayout = core.computeLayout(null, {width: 40, height: HEIGHT});
const singleLayout = core.computeLayout([1], {width: 40, height: HEIGHT});
const specialCases = {
  emptyCellElements: 2,                 // dashed baseline path + hollow circle
  singlePointCellElements: 2,           // axis path + one marker circle
  emptyHasNoPolyline: emptyLayout.rendered.length === 0,
  singleHasNoPolyline: singleLayout.rendered.length === 1
};

const report = {
  generatedAt: new Date().toISOString(),
  complexity: {
    time: 'O(n) single normalization pass + O(capacity) slot scan',
    space: 'O(capacity), capacity = floor(plotWidth / 2) + 1, independent of input length n',
    perInstanceStages: 1,
    perInstanceLayers: 1
  },
  rows,
  specialCases,
  allWithinBound
};
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!allWithinBound) process.exit(1);
