#!/usr/bin/env node
/**
 * Geometry invariants over randomized inputs.
 *
 * Invariant under test: for every rendered sparkline, every pair of adjacent
 * rendered points is >= MIN_POINT_SPACING px apart on x, regardless of input
 * length. A violation would mean points collapsing into a vertical smear at
 * narrow widths — the exact failure mode the slot decimation exists to prevent.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../src/sparkline/sparkline-core.js');

const OUT = path.join(__dirname, '..', 'artifacts', 'sparkline', 'geometry-report.json');
const WIDTHS = [24, 40, 120];
const HEIGHT = 24;
const RUNS = 500;

// Deterministic PRNG so the run is reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

let violations = 0;
const violationSamples = [];
for (let run = 0; run < RUNS; run++) {
  const n = 2 + Math.floor(rand() * 200);
  const data = [];
  for (let i = 0; i < n; i++) data.push(rand() * 100 - 50);
  for (const width of WIDTHS) {
    const layout = core.computeLayout(data, {width, height: HEIGHT});
    for (let i = 1; i < layout.rendered.length; i++) {
      const gap = layout.rendered[i].x - layout.rendered[i - 1].x;
      if (gap < core.MIN_POINT_SPACING - 1e-9) {
        violations++;
        if (violationSamples.length < 10) {
          violationSamples.push({run, width, n, gap,
            x: [layout.rendered[i - 1].x, layout.rendered[i].x]});
        }
      }
    }
    // Markers must respect their own, larger spacing floor except at pins.
    for (let i = 1; i < layout.markers.length; i++) {
      const gap = layout.markers[i].x - layout.markers[i - 1].x;
      const pinned = layout.markerPins.indexOf(layout.markers[i].index) !== -1;
      if (!pinned && gap < core.MIN_MARKER_SPACING - 1e-9) {
        violations++;
      }
    }
  }
}

// -- Edge assertions (the nine checks from the delivery contract) -----------
const checks = [];
function check(name, fn) {
  let passed = false, detail = '';
  try { passed = !!fn(); } catch (e) { detail = e.message; }
  checks.push({name, passed, detail});
}

check('empty data is flagged', () => core.computeLayout(null, {width: 40}).empty);
check('empty data has no points', () => core.computeLayout([], {width: 40}).rendered.length === 0);
check('empty data has dashed-baseline glyph info', () => {
  const g = core.computeLayout(null, {width: 40}).emptyGlyph;
  return g && g.baselineX2 > g.baselineX1 && g.circleR > 0;
});
check('single point flagged', () => core.computeLayout([42], {width: 40}).single);
check('single point renders exactly one marker', () => {
  const l = core.computeLayout([42], {width: 40});
  return l.rendered.length === 1 && l.markers.length === 1;
});
check('single point is horizontally centered', () => {
  const l = core.computeLayout([42], {width: 40});
  return Math.abs(l.rendered[0].x - (l.plot.left + l.plot.right) / 2) < 1e-9;
});
check('constant series gets symmetric domain', () => {
  const d = core.computeLayout([7, 7, 7, 7], {width: 40}).domain;
  return d.synthesized && (d.max - 7) === (7 - d.min);
});
check('constant series stays a horizontal line', () => {
  const l = core.computeLayout([7, 7, 7, 7], {width: 40});
  return new Set(l.rendered.map(p => p.y)).size === 1 && l.rendered.length === 4;
});
check('sparse null/NaN entries are skipped, no throw', () => {
  const l = core.computeLayout([1, null, 2, undefined, NaN, 3], {width: 120});
  return l.inputLength === 3 && l.rendered.length === 3;
});

const failed = checks.filter(c => !c.passed);
const report = {
  generatedAt: new Date().toISOString(),
  randomRuns: RUNS,
  widthsChecked: WIDTHS,
  randomSpacingViolations: violations,
  violationSamples,
  edgeChecks: checks,
  totalChecks: failed.length === 0 && violations === 0 ? 'all passed' : 'FAILURES PRESENT',
  failures: failed
};
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (violations > 0 || failed.length) process.exit(1);
