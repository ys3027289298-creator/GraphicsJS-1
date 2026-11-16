#!/usr/bin/env node
/**
 * Before/after comparison fixture on ONE fixed input.
 *
 * "Before" = the hand-written acgraph polyline a table author would write
 * today: every data point mapped directly onto the plot box, no decimation,
 * no axis, no markers, no empty/single-point handling. Its geometry is
 * reproduced here deterministically so Node tests do not need a DOM.
 *
 * "After" = the sparkline core layout for the same input and sizes.
 *
 * The browser compare.js renders both sides to PNG and diffs pixels; this
 * script owns the coordinate-level numbers in before-after-fixture.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../src/sparkline/sparkline-core.js');

const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'sparkline');
const DATA = [3, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15];
const WIDTHS = [24, 40, 120];
const HEIGHT = 24;
const PADDING = 2;

/**
 * Legacy direct mapping: padding frame only (no marker safety inset),
 * every point retained, x = left + i/(n-1) * plotWidth.
 */
function legacyGeometry(data, width, height) {
  const left = PADDING, right = width - PADDING;
  const top = PADDING, bottom = height - PADDING;
  const min = Math.min.apply(null, data), max = Math.max.apply(null, data);
  const plotWidth = right - left, plotHeight = bottom - top;
  const points = data.map((v, i) => ({
    index: i,
    value: v,
    x: left + (i / (data.length - 1)) * plotWidth,
    y: bottom - ((v - min) / (max - min)) * plotHeight
  }));
  const gaps = points.slice(1).map((p, i) => p.x - points[i].x);
  return {
    approach: 'legacy hand-written acgraph polyline: all points direct-mapped, no decimation',
    padding: PADDING,
    plot: {left, right, top, bottom, width: plotWidth, height: plotHeight},
    domain: {min, max},
    renderedPoints: points.length,
    minAdjacentXGapPx: Math.min.apply(null, gaps),
    points
  };
}

const fixture = {
  generatedAt: new Date().toISOString(),
  input: DATA,
  heights: HEIGHT,
  widths: {}
};

for (const width of WIDTHS) {
  const before = legacyGeometry(DATA, width, HEIGHT);
  const layout = core.computeLayout(DATA, {width, height: HEIGHT});
  const gaps = layout.rendered.slice(1).map((p, i) => p.x - layout.rendered[i].x);
  fixture.widths[width] = {
    before,
    after: {
      approach: 'acgraph.sparkline: slot-decimated geometry, L axis, last-point marker',
      capacity: layout.capacity,
      decimated: layout.decimated,
      markerRadius: layout.markerRadius,
      plot: layout.plot,
      domain: layout.domain,
      renderedPoints: layout.rendered.length,
      renderedIndices: layout.rendered.map(p => p.index),
      minAdjacentXGapPx: gaps.length ? Math.min.apply(null, gaps) : null,
      markers: layout.markers.map(p => ({index: p.index, x: p.x, y: p.y})),
      points: layout.rendered
    }
  };
}

fs.mkdirSync(OUT_DIR, {recursive: true});
fs.writeFileSync(path.join(OUT_DIR, 'before-after-fixture.json'),
  JSON.stringify(fixture, null, 2) + '\n');

// Compact human-readable summary also emitted as JSON for the report.
const summary = {
  generatedAt: fixture.generatedAt,
  input: DATA,
  rows: WIDTHS.map(width => {
    const f = fixture.widths[width];
    return {
      width,
      beforeRenderedPoints: f.before.renderedPoints,
      beforeMinGap: f.before.minAdjacentXGapPx,
      afterRenderedPoints: f.after.renderedPoints,
      afterMinGap: f.after.minAdjacentXGapPx,
      afterDecimated: f.after.decimated,
      afterRenderedIndices: f.after.renderedIndices
    };
  })
};
fs.writeFileSync(path.join(OUT_DIR, 'before-after-report.json'),
  JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
