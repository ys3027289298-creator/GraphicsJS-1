/**
 * @fileoverview Reproducible failure-path matrix. Every invalid input must
 * throw a TreemapError with a stable machine-readable code and the documented
 * message prefix. Run: node tests/failure-paths.js
 */

'use strict';

var treemap = require('../src/treemap');
var TreemapError = treemap.TreemapError;
var createTreemap = treemap.createTreemap;

var cases = [
  {
    name: 'null input',
    run: function() { createTreemap(null); },
    code: 'EMPTY_INPUT',
    messagePrefix: 'treemap input must be a root node object'
  },
  {
    name: 'empty children array',
    run: function() { createTreemap({id: 'x', children: []}); },
    code: 'INVALID_NODE',
    messagePrefix: 'node "x" has an empty children array',
    nodeId: 'x'
  },
  {
    name: 'children is not an array',
    run: function() { createTreemap({id: 'x', children: 'nope'}); },
    code: 'INVALID_NODE',
    messagePrefix: 'node "x" children must be an array',
    nodeId: 'x'
  },
  {
    name: 'child is a primitive',
    run: function() { createTreemap({id: 'root', children: [42]}); },
    code: 'INVALID_NODE',
    messagePrefix: 'node must be an object'
  },
  {
    name: 'negative leaf value',
    run: function() { createTreemap({id: 'x', value: -3}); },
    code: 'NEGATIVE_WEIGHT',
    messagePrefix: 'value must be non-negative, got: -3',
    nodeId: 'x'
  },
  {
    name: 'NaN leaf value',
    run: function() { createTreemap({id: 'x', value: NaN}); },
    code: 'INVALID_WEIGHT',
    messagePrefix: 'value must be a finite number, got: NaN',
    nodeId: 'x'
  },
  {
    name: 'string leaf value',
    run: function() { createTreemap({id: 'x', value: '12'}); },
    code: 'INVALID_WEIGHT',
    messagePrefix: 'value must be a finite number, got: 12',
    nodeId: 'x'
  },
  {
    name: 'infinite leaf value',
    run: function() { createTreemap({id: 'x', value: Infinity}); },
    code: 'INVALID_WEIGHT',
    messagePrefix: 'value must be a finite number, got: Infinity',
    nodeId: 'x'
  },
  {
    name: 'unknown algorithm',
    run: function() { createTreemap({id: 'x', value: 1}, {algorithm: 'mosaic'}); },
    code: 'INVALID_ALGORITHM',
    messagePrefix: 'algorithm must be "squarify" or "slice-dice"'
  },
  {
    name: 'zero canvas width',
    run: function() { createTreemap({id: 'x', value: 1}, {width: 0, height: 600}); },
    code: 'INVALID_BOUNDS',
    messagePrefix: 'width and height must be finite positive numbers'
  },
  {
    name: 'NaN canvas height',
    run: function() { createTreemap({id: 'x', value: 1}, {width: 800, height: NaN}); },
    code: 'INVALID_BOUNDS',
    messagePrefix: 'width and height must be finite positive numbers'
  },
  {
    name: 'padding consumes the canvas',
    run: function() {
      createTreemap({id: 'x', value: 1}, {width: 100, height: 100, padding: 60});
    },
    code: 'INVALID_OPTIONS',
    messagePrefix: 'padding 60 leaves no usable area in a 100 x 100 canvas'
  },
  {
    name: 'negative gap',
    run: function() { createTreemap({id: 'x', value: 1}, {gap: -1}); },
    code: 'INVALID_OPTIONS',
    messagePrefix: 'padding and gap must be finite non-negative numbers'
  },
  {
    name: 'negative padding',
    run: function() { createTreemap({id: 'x', value: 1}, {padding: -2}); },
    code: 'INVALID_OPTIONS',
    messagePrefix: 'padding and gap must be finite non-negative numbers'
  },
  {
    name: 'min font above max font',
    run: function() {
      createTreemap({id: 'x', value: 1}, {minFontSize: 20, maxFontSize: 10});
    },
    code: 'INVALID_OPTIONS',
    messagePrefix: 'minFontSize (20) must not exceed maxFontSize (10)'
  },
  {
    name: 'node limit exceeded',
    run: function() {
      createTreemap({
        id: 'r',
        children: [{id: 'a', value: 1}, {id: 'b', value: 1}, {id: 'c', value: 1}, {id: 'd', value: 1}]
      }, {maxNodes: 3});
    },
    code: 'NODE_LIMIT',
    messagePrefix: 'treemap exceeds maxNodes=3'
  },
  {
    name: 'maxNodes above hard cap',
    run: function() { createTreemap({id: 'x', value: 1}, {maxNodes: 1000001}); },
    code: 'INVALID_OPTIONS',
    messagePrefix: 'maxNodes must be a number in [1, 1000000]'
  },
  {
    name: 'relayout of missing node',
    run: function() {
      var tm = createTreemap({id: 'x', value: 1});
      tm.relayout('ghost');
    },
    code: 'INVALID_NODE',
    messagePrefix: 'relayout target node not found: ghost',
    nodeId: 'ghost'
  }
];

var failures = 0;
cases.forEach(function(testCase, index) {
  var thrown = null;
  try {
    testCase.run();
  } catch (error) {
    thrown = error;
  }
  var problems = [];
  if (!thrown) {
    problems.push('did not throw');
  } else {
    if (!(thrown instanceof TreemapError) || thrown.name !== 'TreemapError') {
      problems.push('not a TreemapError (name=' + thrown.name + ')');
    }
    if (thrown.code !== testCase.code) {
      problems.push('code expected ' + testCase.code + ' got ' + thrown.code);
    }
    if (thrown.message.indexOf(testCase.messagePrefix) !== 0) {
      problems.push('message prefix mismatch: "' + thrown.message + '"');
    }
    if (testCase.nodeId && thrown.nodeId !== testCase.nodeId) {
      problems.push('nodeId expected ' + testCase.nodeId + ' got ' + thrown.nodeId);
    }
  }
  if (problems.length) {
    failures++;
    console.log('FAIL [' + index + '] ' + testCase.name + ' -> ' + problems.join('; '));
  } else {
    console.log('ok   [' + index + '] ' + testCase.name + ' (' + testCase.code + ')');
  }
});

if (failures) {
  console.error('\n' + failures + ' failure-path case(s) failed');
  process.exit(1);
}
console.log('\nAll ' + cases.length + ' failure-path cases passed.');

module.exports = {cases: cases};
