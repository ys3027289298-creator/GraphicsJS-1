/**
 * @fileoverview Deterministic outcomes for the required special cases:
 * all-zero tree, single positive leaf, zero-weight leaf among positive
 * siblings, and drill-down relayout. Run: node tests/edge-cases.test.js
 */

'use strict';

var treemap = require('../src/treemap');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('ok: ' + message);
}

function main() {
  var allZero = treemap.createTreemap({
    id: 'r',
    children: [{id: 'a', value: 0}, {id: 'b', value: 0}]
  }, {width: 200, height: 100});
  assert(allZero.allZeroWeight === true, 'all-zero tree flagged via allZeroWeight');
  assert(allZero.flat.every(function(node) { return node.label === null; }),
    'all-zero tree produces no labels');
  assert(allZero.warnings.length === 1 && /zero weight/.test(allZero.warnings[0]),
    'all-zero tree emits an explicit warning');
  var zeroSvg = treemap.renderToSvg(allZero);
  assert(zeroSvg.indexOf('No data') !== -1 && zeroSvg.indexOf('<rect') === -1,
    'all-zero SVG shows centered notice instead of rectangles');

  var single = treemap.createTreemap({
    id: 'only', name: 'Solo Node', value: 42, color: '#112233'
  }, {width: 800, height: 600});
  assert(single.leafCount === 1 && single.nodeCount === 1, 'single node: counts');
  assert(single.root.rect.width === 800 && single.root.rect.height === 600 &&
    single.root.rect.x === 0 && single.root.rect.y === 0,
  'single positive leaf fills the full outer frame');
  assert(single.root.label && single.root.label.lines[0] === 'Solo Node',
    'single node keeps its label');

  var mixed = treemap.createTreemap({
    id: 'root',
    children: [
      {id: 'p1', value: 9},
      {id: 'p2', value: 1},
      {id: 'zero', value: 0}
    ]
  }, {width: 100, height: 100, padding: 4, gap: 1});
  assert(mixed.zeroWeightLeaves.length === 1 && mixed.zeroWeightLeaves[0] === 'zero',
    'zero-weight leaf id exposed via zeroWeightLeaves');
  var zeroNode = mixed.nodeById.zero;
  assert(zeroNode.rect === null, 'zero-weight leaf has rect=null');
  var positives = mixed.flat.filter(function(node) { return node.isLeaf && node.rect; });
  assert(positives.length === 2, 'positive siblings still tiled');

  var nestedZero = treemap.createTreemap({
    id: 'root',
    children: [
      {id: 'alive', value: 5},
      {id: 'deadbranch', children: [{id: 'd1', value: 0}, {id: 'd2', value: 0}]}
    ]
  }, {width: 120, height: 120});
  assert(nestedZero.nodeById.deadbranch.rect === null &&
    nestedZero.nodeById.d1.rect === null && nestedZero.nodeById.d2.rect === null,
  'all-zero subtree gets rect=null recursively');
  assert(nestedZero.nodeById.alive.rect !== null, 'sibling of zero subtree still tiled');

  var sample = require('./sample-data');
  var full = treemap.createTreemap(sample.SAMPLE_TREE,
    Object.assign({algorithm: 'squarify'}, sample.CANVAS));
  var hardware = full.relayout('hardware');
  assert(hardware.root.id === 'hardware' && hardware.leafCount === 3,
    'drill-down relayout rebuilds from the chosen node');
  assert(hardware.options.width === sample.CANVAS.width,
    'drill-down inherits canvas options');
  var switched = full.relayout('software', {algorithm: 'slice-dice'});
  assert(switched.options.algorithm === 'slice-dice' &&
    full.options.algorithm === 'squarify',
  'relayout option override does not mutate the parent treemap');

  var overflowFree = full.flat.every(function(node) {
    if (!node.rect || !node.label) return true;
    var maxWidth = node.rect.width - 2 * node.label.textPadding;
    var measure = require('../src/treemap/label').measureText;
    return node.label.lines.every(function(line) {
      return measure(line, node.label.fontSize) <= maxWidth + 1e-9;
    });
  });
  assert(overflowFree, 'every label fits its rectangle (zero overflow by construction)');

  var extreme = treemap.createTreemap({
    id: 'root',
    children: [
      {id: 'big', name: 'A reasonably long big label here', value: 9999, color: '#123456'},
      {id: 'tiny', name: 'Tiny Label', value: 1, color: '#654321'}
    ]
  }, {width: 300, height: 300, padding: 2, gap: 1});
  var tinyNode = extreme.nodeById.tiny;
  assert(tinyNode.rect !== null && tinyNode.rect.width >= 0 && tinyNode.rect.height >= 0,
    'degenerate tile never gets a negative-width rect');
  assert(tinyNode.label === null && extreme.metrics.droppedLabels.indexOf('tiny') !== -1,
    'label that cannot fit is dropped and listed in metrics.droppedLabels');
  assert(extreme.nodeById.big.label !== null, 'dominant tile keeps its label');

  console.log('\nEdge-case checks passed.');
}

main();
