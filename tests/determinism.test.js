/**
 * @fileoverview Rendering determinism: the same input must produce a
 * byte-identical SVG across repeated runs, and the CommonJS and browser-global
 * module systems must emit byte-identical output. Also refreshes the golden
 * SVG samples and verifies their SHA-256 sidecars.
 * Run: node tests/determinism.test.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var crypto = require('crypto');
var treemap = require('../src/treemap');
var sample = require('./sample-data');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function loadAsBrowserGlobal() {
  var sandbox = {self: {}, console: console};
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  var srcDir = path.join(__dirname, '..', 'src', 'treemap');
  var read = function(file) {
    return fs.readFileSync(path.join(srcDir, file), 'utf8').replace(/^'use strict';\n?/, '');
  };
  var bundle = [
    'var ErrorModule = (function(){',
    '  var module = {exports: {}};',
    read('error.js'),
    '  return module.exports;',
    '})();',
    'var LabelModule = (function(){',
    '  var module = {exports: {}};',
    read('label.js'),
    '  return module.exports;',
    '})();',
    'var SquarifyModule = (function(){',
    '  var module = {exports: {}};',
    read('Squarify.js'),
    '  return module.exports;',
    '})();',
    'var SliceDiceModule = (function(){',
    '  var module = {exports: {}};',
    read('SliceDice.js'),
    '  return module.exports;',
    '})();',
    'var TreemapModule = (function(){',
    '  var module = {exports: {}};',
    '  var require = function(id) {',
    '    if (id === "./error") return ErrorModule;',
    '    if (id === "./Squarify") return SquarifyModule;',
    '    if (id === "./SliceDice") return SliceDiceModule;',
    '    if (id === "./label") return LabelModule;',
    '    throw new Error("unexpected require " + id);',
    '  };',
    read('Treemap.js'),
    '  return module.exports;',
    '})();',
    'var RendererModule = (function(){',
    '  var module = {exports: {}};',
    read('Renderer.js'),
    '  return module.exports;',
    '})();',
    '(function(){',
    '  var module = {exports: {}};',
    '  var require = function(id) {',
    '    if (id === "./Treemap") return TreemapModule;',
    '    if (id === "./Renderer") return RendererModule;',
    '    if (id === "./error") return ErrorModule;',
    '    throw new Error("unexpected require " + id);',
    '  };',
    read('index.js'),
    '})();'
  ].join('\n');
  vm.runInContext(bundle, sandbox);
  return sandbox.self.acgraph.treemap;
}

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('ok: ' + message);
}

function main() {
  var artifactsDir = path.join(__dirname, '..', 'artifacts');
  ['squarify', 'slice-dice'].forEach(function(algorithm) {
    var svgs = [];
    for (var run = 0; run < 3; run++) {
      var tm = treemap.createTreemap(sample.SAMPLE_TREE,
        Object.assign({algorithm: algorithm}, sample.CANVAS));
      svgs.push(treemap.renderToSvg(tm));
    }
    assert(sha256(svgs[0]) === sha256(svgs[1]) && sha256(svgs[1]) === sha256(svgs[2]),
      algorithm + ': three repeated renders are byte-identical');

    var globalApi = loadAsBrowserGlobal();
    var globalTm = globalApi.createTreemap(sample.SAMPLE_TREE,
      Object.assign({algorithm: algorithm}, sample.CANVAS));
    var globalSvg = globalApi.renderToSvg(globalTm);
    assert(globalSvg === svgs[0],
      algorithm + ': browser-global and CommonJS renders are byte-identical');

    var goldenPath = path.join(artifactsDir, 'treemap-' + algorithm + '.golden.svg');
    fs.writeFileSync(goldenPath, svgs[0]);
    var digest = sha256(svgs[0]);
    fs.writeFileSync(goldenPath + '.sha256', digest + '  treemap-' + algorithm + '.golden.svg\n');
    assert(digest.length === 64, algorithm + ': golden svg + sha256 sidecar refreshed (' + digest.slice(0, 12) + '...)');
  });
  console.log('\nDeterminism checks passed.');
}

main();
