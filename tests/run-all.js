/**
 * @fileoverview One-command entry point for the whole verification suite.
 * Run: node --expose-gc tests/run-all.js
 */

'use strict';

var childProcess = require('child_process');
var path = require('path');

var scripts = [
  'edge-cases.test.js',
  'failure-paths.js',
  'before-after.js',
  'algorithm-comparison.js',
  'bundle.js',
  'determinism.test.js',
  'acgraph-integration.test.js',
  'regression-check.js',
  'memory-bound.js'
];

var failed = 0;
scripts.forEach(function(script) {
  console.log('\n=== ' + script + ' ===');
  var result = childProcess.spawnSync(process.execPath,
    ['--expose-gc', path.join(__dirname, script)],
    {stdio: 'inherit'});
  if (result.status !== 0) {
    failed++;
    console.error('!!! ' + script + ' exited with ' + result.status);
  }
});

if (failed) {
  console.error('\n' + failed + ' suite(s) failed.');
  process.exit(1);
}
console.log('\nAll suites passed.');
