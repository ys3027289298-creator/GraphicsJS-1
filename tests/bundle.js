/**
 * @fileoverview Minimal CommonJS bundler for the treemap modules. Produces
 * demos/treemap-bundle.js, a self-contained UMD file that attaches
 * window.acgraph.treemap without touching the main graphics.js build.
 * Run: node tests/bundle.js
 */

'use strict';

var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var modules = [
  'treemap/error.js',
  'treemap/label.js',
  'treemap/Squarify.js',
  'treemap/SliceDice.js',
  'treemap/Treemap.js',
  'treemap/Renderer.js',
  'treemap/index.js'
];

function bundleModule(relativePath) {
  var source = fs.readFileSync(path.join(root, 'src', relativePath), 'utf8')
    .replace(/^'use strict';\n?/, '');
  var moduleId = './' + path.basename(relativePath);
  source = source.replace(/require\('(\.\/[^']+?)'\)/g, function(match, id) {
    return "require('" + (id.indexOf('.js') === -1 ? id + '.js' : id) + "')";
  });
  return [
    'modules[' + JSON.stringify(moduleId) + '] = function(module, exports, require) {',
    source,
    '};'
  ].join('\n');
}

var prelude = [
  '(function(root, factory) {',
  '  var api = factory();',
  '  if (typeof module === "object" && module.exports) module.exports = api;',
  '  if (typeof define === "function" && define.amd) define([], function() { return api; });',
  '  root.acgraph = root.acgraph || {};',
  '  root.acgraph.treemap = api;',
  '})(typeof self !== "undefined" ? self : this, function() {',
  '  "use strict";',
  '  var cache = {};',
  '  var modules = {};',
  modules.map(bundleModule).join('\n'),
  '  function require(id) {',
  '    if (cache[id]) return cache[id].exports;',
  '    if (!modules[id]) throw new Error("treemap bundle: unknown module " + id);',
  '    var record = cache[id] = {exports: {}};',
  '    modules[id](record, record.exports, require);',
  '    return record.exports;',
  '  }',
  '  return require("./index.js");',
  '});',
  ''
].join('\n');

var target = path.join(root, 'demos', 'treemap-bundle.js');
fs.writeFileSync(target, prelude);
console.log('wrote ' + target + ' (' + Buffer.byteLength(prelude) + ' bytes)');
