/**
 * @fileoverview Same data, same canvas, both tiling algorithms: aspect ratio
 * distribution and void ratio. Also asserts overlap/bounds invariants.
 * Run: node tests/algorithm-comparison.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var treemap = require('../src/treemap');
var sample = require('./sample-data');

function rectsOf(tm) {
  return tm.flat
    .filter(function(node) { return node.isLeaf && node.rect; })
    .map(function(node) {
      return Object.assign({id: node.id}, node.rect);
    });
}

function overlap(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
           a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function assertInvariants(tm, algorithm) {
  var rects = rectsOf(tm);
  for (var i = 0; i < rects.length; i++) {
    for (var j = i + 1; j < rects.length; j++) {
      if (overlap(rects[i], rects[j])) {
        throw new Error(algorithm + ': overlapping rects ' + rects[i].id + ' / ' + rects[j].id);
      }
    }
  }
  var bounds = {
    minX: sample.CANVAS.padding,
    minY: sample.CANVAS.padding,
    maxX: sample.CANVAS.width - sample.CANVAS.padding,
    maxY: sample.CANVAS.height - sample.CANVAS.padding
  };
  rects.forEach(function(rect) {
    if (rect.x < bounds.minX - 1e-9 || rect.y < bounds.minY - 1e-9 ||
        rect.x + rect.width > bounds.maxX + 1e-9 ||
        rect.y + rect.height > bounds.maxY + 1e-9) {
      throw new Error(algorithm + ': rect ' + rect.id + ' escapes usable area');
    }
  });
  var overflow = tm.flat.filter(function(node) {
    return node.rect && node.label &&
      node.label.lines.some(function(line) {
        return line.length > 0;
      }) === false;
  });
  if (overflow.length) {
    throw new Error(algorithm + ': labels in invalid state');
  }
}

function summarize(algorithm) {
  var tm = treemap.createTreemap(sample.SAMPLE_TREE,
    Object.assign({algorithm: algorithm}, sample.CANVAS));
  assertInvariants(tm, algorithm);
  return {
    algorithm: algorithm,
    aspectRatio: tm.metrics.aspectRatio,
    usableArea: tm.metrics.usableArea,
    coveredArea: tm.metrics.coveredArea,
    voidArea: tm.metrics.voidArea,
    voidRatio: tm.metrics.voidRatio,
    voidPercent: tm.metrics.voidPercent,
    labelCoverage: tm.metrics.labelCoverage,
    droppedLabels: tm.metrics.droppedLabels
  };
}

function main() {
  var result = {
    sharedInput: 'tests/sample-data.js (total weight 1200, 10 positive leaves)',
    canvas: sample.CANVAS,
    squarify: summarize('squarify'),
    'slice-dice': summarize('slice-dice')
  };
  var target = path.join(__dirname, '..', 'artifacts', 'algorithm-comparison.json');
  fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nwrote ' + target);
}

main();
