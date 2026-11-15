/**
 * @fileoverview Before/after comparison on the very same input. "Before"
 * reproduces the manual strip-of-rectangles approach callers had to build
 * without a treemap: every leaf stacked in one horizontal band, no hierarchy,
 * no label strategy, zero-weight leaves emitted as degenerate rectangles.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var treemap = require('../src/treemap');
var sample = require('./sample-data');

function collectLeaves(node, out) {
  if (!node.children) {
    out.push({id: node.id, name: node.name, value: node.value});
  } else {
    node.children.forEach(function(child) { collectLeaves(child, out); });
  }
  return out;
}

function manualStrip(leaves, canvas) {
  var total = leaves.reduce(function(sum, leaf) { return sum + Math.max(leaf.value, 0); }, 0);
  var x = canvas.padding;
  var y = canvas.padding;
  var height = canvas.height - 2 * canvas.padding;
  var width = canvas.width - 2 * canvas.padding;
  var zeroStacked = 0;
  var zeroStackX = null;
  var rects = leaves.map(function(leaf) {
    if (leaf.value === 0) {
      if (zeroStackX === null) zeroStackX = x;
      zeroStacked++;
      return {id: leaf.id, x: x, y: y, width: 0, height: height};
    }
    var leafWidth = leaf.value / total * width;
    var rect = {id: leaf.id, x: x, y: y, width: leafWidth, height: height};
    x += leafWidth;
    return rect;
  });
  var ratios = rects
    .filter(function(rect) { return rect.width > 0; })
    .map(function(rect) { return Math.max(rect.width, rect.height) / Math.min(rect.width, rect.height); });
  return {
    rectCount: rects.length,
    meanAspectRatio: ratios.reduce(function(a, b) { return a + b; }, 0) / ratios.length,
    worstAspectRatio: Math.max.apply(null, ratios),
    zeroWeightBehavior: zeroStacked + ' zero-width rect(s) stacked at x=' +
      zeroStackX + '; result undefined',
    labelStrategy: 'undefined behavior: callers place raw text with no ' +
      'measurement, long names overflow their rectangles',
    hierarchy: 'flat strip, no grouping or drill-down',
    switchableAlgorithm: false,
    voidMetric: 'not measured'
  };
}

function main() {
  var leaves = collectLeaves(sample.SAMPLE_TREE, []);
  var before = manualStrip(leaves, sample.CANVAS);

  var after = treemap.createTreemap(sample.SAMPLE_TREE,
    Object.assign({algorithm: 'squarify'}, sample.CANVAS));
  var rectCount = after.flat.filter(function(node) { return node.rect; }).length;
  var afterResult = {
    approach: 'acgraph.treemap recursive squarify',
    nodeCount: after.nodeCount,
    rectCount: rectCount,
    meanAspectRatio: after.metrics.aspectRatio.mean,
    worstAspectRatio: after.metrics.aspectRatio.max,
    zeroWeightBehavior: after.zeroWeightLeaves.join(',') +
      ' rect=null; ids exposed via zeroWeightLeaves; explicit warning channel exists',
    labelStrategy: 'shrink size -> wrap -> ellipsis -> drop; overflow count = 0 by construction',
    hierarchy: 'recursive groups with relayout(node) drill-down',
    switchableAlgorithm: true,
    voidRatio: after.metrics.voidRatio
  };

  var output = {
    sharedInput: {
      file: 'tests/sample-data.js',
      totalWeight: after.root.weight,
      leafCount: after.leafCount,
      zeroWeightLeaves: after.zeroWeightLeaves,
      canvas: sample.CANVAS
    },
    before: before,
    after: afterResult
  };

  var target = path.join(__dirname, '..', 'artifacts', 'before-after.json');
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
  console.log('\nwrote ' + target);
}

main();
