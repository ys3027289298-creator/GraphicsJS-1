/**
 * Single entry point for the whole heatmap verification suite.
 * Run: node --expose-gc test/heatmap/run-all.js
 */
'use strict';

const {spawnSync} = require('child_process');
const path = require('path');

const steps = [
  {cmd: process.execPath, args: ['test/heatmap/unit.test.js'], gc: false},
  {cmd: process.execPath, args: ['test/heatmap/regression.test.js'], gc: false},
  {cmd: process.execPath, args: ['test/heatmap/integration.test.js'], gc: false},
  {cmd: process.execPath, args: ['test/heatmap/failure-paths.js'], gc: false},
  {cmd: process.execPath, args: ['--expose-gc', 'test/heatmap/memory-bounds.js'], gc: true},
  {cmd: process.execPath, args: ['test/heatmap/render-artifacts.js'], gc: false},
  {cmd: process.execPath, args: ['test/heatmap/before-after.js'], gc: false}
];

let failed = 0;
for (const step of steps) {
  console.log('\n=== ' + path.basename(step.args[step.args.length - 1]) + ' ===');
  const result = spawnSync(step.cmd, step.args, {stdio: 'inherit', cwd: path.join(__dirname, '..', '..')});
  if (result.status !== 0) {
    failed++;
    console.error('STEP FAILED: ' + step.args.join(' '));
  }
}
if (failed) {
  console.error('\n' + failed + ' step(s) failed');
  process.exit(1);
}
console.log('\nAll heatmap verification steps passed');
