/**
 * @fileoverview Loads the unmodified dist/graphics.js inside a vm with a
 * minimal DOM stub, verifies the public acgraph API surface is intact, then
 * loads the treemap module in the same context and proves:
 * 1. no pre-existing acgraph key is added, removed or replaced;
 * 2. renderToStage draws through the real Stage public API;
 * 3. a treemap built and reloaded twice yields identical results.
 * Run: node tests/acgraph-integration.test.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var treemap = require('../src/treemap');
var sample = require('./sample-data');

function makeElement(tag) {
  var element = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    attributes: {},
    childNodes: [],
    classList: {
      add: function() {},
      remove: function() {},
      contains: function() { return false; }
    },
    appendChild: function(child) {
      this.children.push(child);
      this.childNodes.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild: function(child) { return child; },
    insertBefore: function(child) { this.children.push(child); return child; },
    setAttribute: function(key, value) { this.attributes[key] = value; },
    getAttribute: function(key) { return this.attributes[key]; },
    removeAttribute: function(key) { delete this.attributes[key]; },
    addEventListener: function() {},
    removeEventListener: function() {},
    getElementsByTagName: function() { return []; },
    getBBox: function() { return {x: 0, y: 0, width: 10, height: 10}; },
    getBoundingClientRect: function() { return {left: 0, top: 0, width: 10, height: 10}; },
    ownerDocument: null
  };
  return element;
}

function buildSandbox() {
  var documentStub = {
    createElement: function(tag) {
      var element = makeElement(tag);
      element.ownerDocument = this;
      return element;
    },
    createElementNS: function(namespace, tag) {
      var element = makeElement(tag);
      element.ownerDocument = this;
      return element;
    },
    createTextNode: function(text) {
      return {nodeType: 3, nodeValue: text, parentNode: null};
    },
    createComment: function() { return makeElement('comment'); },
    getElementById: function() { return null; },
    getElementsByTagName: function() { return []; },
    documentElement: makeElement('html'),
    body: makeElement('body'),
    head: makeElement('head')
  };
  var windowStub = {
    document: documentStub,
    devicePixelRatio: 1,
    addEventListener: function() {},
    removeEventListener: function() {},
    matchMedia: function() { return {matches: false}; },
    navigator: {userAgent: 'node-stub'},
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  windowStub.window = windowStub;
  var sandbox = {
    window: windowStub,
    document: documentStub,
    navigator: windowStub.navigator,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: console
  };
  vm.createContext(sandbox);
  var source = fs.readFileSync(
    path.join(__dirname, '..', 'dist', 'graphics.js'), 'utf8');
  vm.runInContext(source, sandbox, {filename: 'graphics.js'});
  return {sandbox: sandbox, document: documentStub};
}

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('ok: ' + message);
}

function main() {
  var env = buildSandbox();
  var acgraph = env.sandbox.acgraph;

  assert(typeof acgraph === 'object' && acgraph, 'acgraph global bootstrapped from dist/graphics.js');
  ['create', 'getStage', 'StageType', 'vector', 'events', 'module'].forEach(function(key) {
    assert(key in acgraph, 'acgraph.' + key + ' API exists');
  });

  var stage = acgraph.create(env.document.body, 800, 600);
  ['rect', 'text', 'layer', 'render'].forEach(function(method) {
    assert(typeof stage[method] === 'function', 'Stage.prototype.' + method + ' exists');
  });
  ['Rect', 'Text', 'Layer'].forEach(function(className) {
    assert(typeof acgraph.vector[className] === 'function', 'acgraph.vector.' + className + ' class exists');
  });

  var keysBefore = Object.keys(acgraph).sort();
  var snapshot = keysBefore.map(function(key) { return [key, acgraph[key]]; });

  var srcDir = path.join(__dirname, '..', 'src', 'treemap');
  var load = function(file) {
    return fs.readFileSync(path.join(srcDir, file), 'utf8').replace(/^'use strict';\n?/, '');
  };
  var prelude = [
    'var ErrorModule = (function(){ var module = {exports: {}};',
    load('error.js'), 'return module.exports; })();',
    'var LabelModule = (function(){ var module = {exports: {}};',
    load('label.js'), 'return module.exports; })();',
    'var SquarifyModule = (function(){ var module = {exports: {}};',
    load('Squarify.js'), 'return module.exports; })();',
    'var SliceDiceModule = (function(){ var module = {exports: {}};',
    load('SliceDice.js'), 'return module.exports; })();',
    'var TreemapModule = (function(){',
    '  var module = {exports: {}};',
    '  var require = function(id) {',
    '    if (id === "./error") return ErrorModule;',
    '    if (id === "./Squarify") return SquarifyModule;',
    '    if (id === "./SliceDice") return SliceDiceModule;',
    '    if (id === "./label") return LabelModule;',
    '    throw new Error("unexpected require " + id);',
    '  };',
    load('Treemap.js'), 'return module.exports; })();',
    'var RendererModule = (function(){ var module = {exports: {}};',
    load('Renderer.js'), 'return module.exports; })();',
    '(function(){',
    '  var module = {exports: {}};',
    '  var require = function(id) {',
    '    if (id === "./Treemap") return TreemapModule;',
    '    if (id === "./Renderer") return RendererModule;',
    '    if (id === "./error") return ErrorModule;',
    '    throw new Error("unexpected require " + id);',
    '  };',
    load('index.js'),
    '})();'
  ].join('\n');
  vm.runInContext(prelude, env.sandbox);

  assert(env.sandbox.acgraph.treemap, 'acgraph.treemap namespace attached');
  var keysAfter = Object.keys(acgraph).sort();
  assert(keysAfter.length === keysBefore.length + 1,
    'exactly one acgraph key added (treemap)');
  var untouched = snapshot.every(function(pair) { return acgraph[pair[0]] === pair[1]; });
  assert(untouched, 'every pre-existing acgraph key keeps the same reference');

  var tm = treemap.createTreemap(sample.SAMPLE_TREE,
    Object.assign({algorithm: 'squarify'}, sample.CANVAS));
  var drawStage = acgraph.create(env.document.body, 800, 600);
  var returnedStage = treemap.renderToStage(tm, drawStage);
  assert(returnedStage === drawStage, 'renderToStage returns the same Stage instance');
  var rectElements = drawStage.domElement().children[0]
    ? drawStage.domElement().children.length
    : 0;
  assert(rectElements >= 1, 'stage DOM received drawn elements (' + rectElements + ' top-level nodes)');

  var second = treemap.createTreemap(sample.SAMPLE_TREE,
    Object.assign({algorithm: 'squarify'}, sample.CANVAS));
  assert(treemap.renderToSvg(tm) === treemap.renderToSvg(second),
    'two independent builds render identical SVG');

  var badStage = null;
  try {
    treemap.renderToStage(tm, badStage);
    assert(false, 'renderToStage rejects non-Stage input');
  } catch (error) {
    assert(error instanceof TypeError, 'renderToStage throws TypeError without a Stage');
  }
  console.log('\nacgraph integration checks passed.');
}

main();
