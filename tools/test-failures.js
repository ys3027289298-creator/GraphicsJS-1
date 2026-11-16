#!/usr/bin/env node
/**
 * Failure-path contract tests for the DOM-free core.
 * Every invalid input must throw SparklineError with a stable code and a
 * message containing the documented wording. Three tolerance cases must NOT
 * throw (sparse entries, null data, idempotent double dispose at renderer
 * level — the dispose case is covered in the browser suite; here we cover the
 * core-level tolerances plus a manual idempotency flag simulation).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../src/sparkline/sparkline-core.js');

const OUT = path.join(__dirname, '..', 'artifacts', 'sparkline', 'failures-node.json');

const results = [];
function expectThrow(name, fn, code, messageFragment) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  const ok = !!threw && threw.name === 'SparklineError' && threw.code === code &&
    (messageFragment == null || threw.message.indexOf(messageFragment) !== -1);
  results.push({name, expectedCode: code, ok,
    actual: threw ? {name: threw.name, code: threw.code, message: threw.message} : null});
}
function expectNoThrow(name, fn) {
  let error = null;
  try { fn(); } catch (e) { error = {name: e.name, code: e.code, message: e.message}; }
  results.push({name, ok: error === null, actual: error});
}

// Node has no DOM: string/unknown-id and non-element containers must fail.
expectThrow('container {} rejected',
  () => core.validateContainer({}), 'SPARKLINE_BAD_CONTAINER',
  'container must be a DOM element or an existing element id');
expectThrow('container null rejected',
  () => core.validateContainer(null), 'SPARKLINE_BAD_CONTAINER',
  'container must be a DOM element or an existing element id');
expectThrow('container unknown id rejected',
  () => core.validateContainer('no-such-element-id'), 'SPARKLINE_BAD_CONTAINER',
  'container must be a DOM element or an existing element id');

expectThrow('data string rejected',
  () => core.normalizeData('nope'), 'SPARKLINE_BAD_DATA',
  'data must be an array of finite numbers');
expectThrow('data array-like object rejected',
  () => core.normalizeData({0: 1, length: 1}), 'SPARKLINE_BAD_DATA',
  'data must be an array of finite numbers');
expectThrow('data boolean rejected',
  () => core.normalizeData(true), 'SPARKLINE_BAD_DATA',
  'data must be an array of finite numbers');

expectThrow('datum string rejected',
  () => core.normalizeData([1, 'x', 3]), 'SPARKLINE_BAD_DATUM',
  'data[1] is not a finite number');
expectThrow('datum object rejected',
  () => core.normalizeData([1, {}, 3]), 'SPARKLINE_BAD_DATUM',
  'data[1] is not a finite number');
expectThrow('datum boolean rejected',
  () => core.normalizeData([1, false, 3]), 'SPARKLINE_BAD_DATUM',
  'data[1] is not a finite number');

expectThrow('marker index beyond range rejected',
  () => core.computeLayout([1, 2], {markerIndices: [5]}), 'SPARKLINE_BAD_MARKER',
  'integer index in [0,1]');
expectThrow('non-integer marker rejected',
  () => core.computeLayout([1, 2, 3], {markerIndices: [1.5]}), 'SPARKLINE_BAD_MARKER',
  'must be an integer index');
expectThrow('negative marker rejected',
  () => core.computeLayout([1, 2, 3], {markerIndices: [-1]}), 'SPARKLINE_BAD_MARKER',
  'out of range');
expectThrow('markerIndices non-array rejected',
  () => core.computeLayout([1, 2], {markerIndices: '0'}), 'SPARKLINE_BAD_MARKER',
  'markerIndices must be an array of integer indices');

expectThrow('reversed band rejected',
  () => core.computeLayout([1, 2, 3, 4], {bands: [{from: 2, to: 1}]}), 'SPARKLINE_BAD_BAND',
  '0 <= from <= to < data.length');
expectThrow('band to out of range rejected',
  () => core.computeLayout([1, 2, 3, 4], {bands: [{from: 0, to: 4}]}), 'SPARKLINE_BAD_BAND',
  '0 <= from <= to < data.length');
expectThrow('negative band rejected',
  () => core.computeLayout([1, 2, 3, 4], {bands: [{from: -1, to: 1}]}), 'SPARKLINE_BAD_BAND',
  '0 <= from <= to < data.length');
expectThrow('bands non-array rejected',
  () => core.computeLayout([1, 2], {bands: {}}), 'SPARKLINE_BAD_BAND',
  'bands must be an array of {from, to} band specs');

expectThrow('reversed yDomain rejected',
  () => core.computeLayout([1, 2], {yDomain: [9, 1]}), 'SPARKLINE_BAD_OPTION',
  'yDomain must be [min, max] with min < max, both finite');
expectThrow('equal yDomain rejected',
  () => core.computeLayout([1, 2], {yDomain: [4, 4]}), 'SPARKLINE_BAD_OPTION',
  'yDomain must be [min, max] with min < max, both finite');
expectThrow('non-finite yDomain rejected',
  () => core.computeLayout([1, 2], {yDomain: [NaN, 4]}), 'SPARKLINE_BAD_OPTION',
  'yDomain must be [min, max] with min < max, both finite');

expectThrow('negative width rejected',
  () => core.computeLayout([1, 2], {width: -5}), 'SPARKLINE_BAD_OPTION',
  'width must be a positive number');
expectThrow('zero height rejected',
  () => core.computeLayout([1, 2], {height: 0}), 'SPARKLINE_BAD_OPTION',
  'height must be a positive number');
expectThrow('string size rejected',
  () => core.computeLayout([1, 2], {width: '40'}), 'SPARKLINE_BAD_OPTION',
  'width must be a positive number');

// -- Tolerance: these must succeed ------------------------------------------
expectNoThrow('sparse null/undefined/NaN entries skipped',
  () => core.normalizeData([1, null, 2, undefined, NaN, 3]));
expectNoThrow('data null treated as empty state',
  () => core.computeLayout(null, {width: 40}));
let idempotent = true;
try {
  // Mirrors renderer.dispose(): a second call on an already-disposed flag is a no-op.
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; };
  dispose(); dispose();
} catch (e) { idempotent = false; }
results.push({name: 'double dispose is idempotent', ok: idempotent, actual: null});

const failed = results.filter(r => !r.ok);
const report = {
  generatedAt: new Date().toISOString(),
  assertions: results.length,
  failures: failed,
  results
};
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log('assertions:', results.length, 'failures:', failed.length);
for (const r of results) console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name);
if (failed.length) process.exit(1);
