/**
 * @fileoverview Empirical resource bounds for the treemap engine. Builds
 * balanced synthetic trees at four scales, forces GC around each run and
 * records heap delta plus wall time. Run with: node --expose-gc tests/memory-bound.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var treemap = require('../src/treemap');

/**
 * Builds a balanced tree whose depth grows with scale: 100 -> depth 2,
 * 1k -> 3, 10k -> 4, 100k -> 5. Each internal level uses a 10-way fan-out.
 * @param {number} leafCount
 * @return {Object}
 */
function buildBalancedTree(leafCount) {
  var id = 0;
  function leaf() {
    id++;
    return {id: 'leaf-' + id, name: 'Leaf ' + id, value: (id % 7) + 1};
  }
  function build(count, depthLeft) {
    if (depthLeft === 0 || count === 1) {
      var out = [];
      for (var i = 0; i < count; i++) out.push(leaf());
      return out;
    }
    var groups = Math.min(10, count);
    var children = [];
    var assigned = 0;
    for (var g = 0; g < groups; g++) {
      var share = g === groups - 1 ? count - assigned : Math.round(count / groups);
      assigned += share;
      if (share === 1) {
        children.push(leaf());
      } else {
        children.push({
          id: 'group-' + id++,
          name: 'Group ' + id,
          children: build(share, depthLeft - 1)
        });
      }
    }
    return children;
  }
  var depthMap = {100: 2, 1000: 3, 10000: 4, 100000: 5};
  var depth = depthMap[leafCount] || Math.max(1, Math.ceil(Math.log(leafCount) / Math.LN10));
  return {id: 'root', name: 'Root', children: build(leafCount, depth - 1)};
}

function treeDepth(node) {
  if (!node.children) return 0;
  return 1 + Math.max.apply(null, node.children.map(treeDepth));
}

function measure(leafCount) {
  var input = buildBalancedTree(leafCount);
  if (typeof global.gc !== 'function') {
    throw new Error('run with --expose-gc so heap deltas are meaningful');
  }
  global.gc();
  var heapBefore = process.memoryUsage().heapUsed;
  var start = process.hrtime.bigint();
  var tm = treemap.createTreemap(input, {
    width: 1600,
    height: 1200,
    padding: 2,
    gap: 1,
    maxNodes: treemap.MAX_NODES_HARD_CAP
  });
  var elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  global.gc();
  var heapAfter = process.memoryUsage().heapUsed;
  var heapDeltaKiB = Math.round((heapAfter - heapBefore) / 1024);
  var nodeCount = tm.nodeCount;
  var depth = treeDepth(input);
  var row = {
    nodeCount: nodeCount,
    leafCount: leafCount,
    depth: depth,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    heapDeltaKiB: heapDeltaKiB,
    bytesPerNode: Math.round((heapAfter - heapBefore) / nodeCount)
  };
  tm.__retain = true;
  return {row: row, retained: tm};
}

function main() {
  var scales = [100, 1000, 10000, 100000];
  var rows = [];
  var retained = [];
  scales.forEach(function(leafCount) {
    var result = measure(leafCount);
    rows.push(result.row);
    retained.push(result.retained);
    console.log(JSON.stringify(result.row));
  });
  var largest = rows[rows.length - 1];
  var output = {
    rows: rows,
    analytic: {
      timeComplexity: 'O(N) traversals; squarify adds O(N log N) worst case from sibling sorting',
      memoryComplexity: 'O(N): one normalized object per node, at most one rect and one label each',
      hardNodeCap: treemap.MAX_NODES_HARD_CAP,
      maxNodesEnforcement: 'NODE_LIMIT thrown during the single normalization walk before layout allocations',
      rendererElementBound: 'at most 2 elements (rect + text) per node with a rect, i.e. <= 2 * V elements',
      measuredBytesPerNodeAt100k: largest.bytesPerNode,
      measuredMsAt100k: largest.elapsedMs
    }
  };
  var target = path.join(__dirname, '..', 'artifacts', 'memory-bound.json');
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
  var txtTarget = path.join(__dirname, '..', 'artifacts', 'memory-bound.txt');
  fs.writeFileSync(txtTarget, rows.map(function(row) { return JSON.stringify(row); }).join('\n') +
    '\n\n' + JSON.stringify(output.analytic, null, 2) + '\n\nwritten to ' + target + '\n');
  console.log('\n' + JSON.stringify(output.analytic, null, 2));
  console.log('\nwritten to ' + target);
  retained.length = 0;
}

main();
