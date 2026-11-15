/**
 * @fileoverview Proves existing behavior is untouched:
 * 1. every tracked, non-submodule file has the same SHA-256 recorded before
 *    the treemap work (artifacts/checksums-before.txt);
 * 2. dist/graphics.js keeps its original hash and contains no treemap symbol;
 * 3. git reports no modified tracked files.
 * Run: node tests/regression-check.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var childProcess = require('child_process');

var root = path.join(__dirname, '..');

function sha256OfFile(relativePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, relativePath)))
    .digest('hex');
}

function parseChecksumFile(name) {
  return fs.readFileSync(path.join(root, 'artifacts', name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(function(line) {
      var parts = line.trim().split(/\s+/);
      return {hash: parts[0], file: parts[1].replace(/^\.\//, '')};
    });
}

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('ok: ' + message);
}

function main() {
  var before = parseChecksumFile('checksums-before.txt');
  var current = before.map(function(entry) {
    return {hash: sha256OfFile(entry.file), file: entry.file};
  });
  assert(before.length === 68, 'baseline covers 68 tracked non-submodule files');
  var allMatch = before.every(function(entry, index) {
    return entry.hash === current[index].hash;
  });
  assert(allMatch, 'all 68 pre-existing files are bit-identical to baseline');

  var currentChecksums = current.map(function(entry) {
    return entry.hash + '  ' + entry.file;
  }).join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'artifacts', 'checksums-untouched.txt'), currentChecksums);

  var distPath = path.join(root, 'dist', 'graphics.js');
  var distHash = sha256OfFile('dist/graphics.js');
  var baselineDist = before.find(function(entry) { return entry.file === 'dist/graphics.js'; });
  assert(distHash === baselineDist.hash, 'dist/graphics.js SHA-256 unchanged');
  var distSource = fs.readFileSync(distPath, 'utf8');
  assert(distSource.indexOf('treemap') === -1 && distSource.indexOf('Treemap') === -1,
    'dist/graphics.js contains no treemap symbols (full isolation)');

  var status = childProcess.execSync('git status --porcelain', {cwd: root}).toString();
  var modifiedTracked = status.split('\n')
    .filter(Boolean)
    .filter(function(line) { return line.charAt(0) === 'M' || line.charAt(1) === 'M'; });
  assert(modifiedTracked.length === 0,
    'git reports zero modified tracked files (only additions): ' +
    (modifiedTracked.length ? modifiedTracked.join('; ') : 'clean'));
  console.log('\nRegression check passed.');
}

main();
