/**
 * @fileoverview Treemap engine: input validation, tree normalization with
 * weight aggregation, recursive gap-aware layout, drill-down relayout and
 * geometry metrics. Tiling algorithms are pluggable.
 */

'use strict';

var TreemapError = require('./error').TreemapError;
var ERROR_CODES = require('./error').ERROR_CODES;
var squarify = require('./Squarify').squarify;
var sliceDice = require('./SliceDice').sliceDice;
var fitLabel = require('./label').fitLabel;

var MAX_NODES_HARD_CAP = 1000000;
var DEFAULT_OPTIONS = {
  width: 800,
  height: 600,
  padding: 6,
  gap: 2,
  algorithm: 'squarify',
  minFontSize: 13,
  maxFontSize: 18,
  fontStep: 5,
  fontFamily: 'sans-serif',
  maxNodes: MAX_NODES_HARD_CAP
};

function fail(code, message, nodeId) {
  throw new TreemapError(code, message, nodeId);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Counts nodes before any allocation so NODE_LIMIT fires without building a tree.
 * @param {*} input
 * @return {number}
 */
function countNodes(input) {
  var count = 0;
  (function walk(node) {
    count++;
    if (isPlainObject(node) && Array.isArray(node.children)) {
      for (var i = 0; i < node.children.length; i++) walk(node.children[i]);
    }
  })(input);
  return count;
}

function validateOptions(options) {
  var opts = {};
  var key;
  for (key in DEFAULT_OPTIONS) {
    if (DEFAULT_OPTIONS.hasOwnProperty(key)) opts[key] = DEFAULT_OPTIONS[key];
  }
  for (key in options) {
    if (options.hasOwnProperty(key)) opts[key] = options[key];
  }

  if (typeof opts.width !== 'number' || typeof opts.height !== 'number' ||
      !isFinite(opts.width) || !isFinite(opts.height) ||
      opts.width <= 0 || opts.height <= 0) {
    fail(ERROR_CODES.INVALID_BOUNDS,
      'width and height must be finite positive numbers');
  }
  if (typeof opts.padding !== 'number' || typeof opts.gap !== 'number' ||
      !isFinite(opts.padding) || !isFinite(opts.gap) ||
      opts.padding < 0 || opts.gap < 0) {
    fail(ERROR_CODES.INVALID_OPTIONS,
      'padding and gap must be finite non-negative numbers');
  }
  if (opts.algorithm !== 'squarify' && opts.algorithm !== 'slice-dice') {
    fail(ERROR_CODES.INVALID_ALGORITHM,
      'algorithm must be "squarify" or "slice-dice", got: ' + opts.algorithm);
  }
  if (typeof opts.minFontSize !== 'number' || typeof opts.maxFontSize !== 'number' ||
      !isFinite(opts.minFontSize) || !isFinite(opts.maxFontSize) ||
      opts.minFontSize <= 0 || opts.maxFontSize <= 0) {
    fail(ERROR_CODES.INVALID_OPTIONS,
      'minFontSize and maxFontSize must be finite positive numbers');
  }
  if (typeof opts.fontStep !== 'number' || !isFinite(opts.fontStep) ||
      opts.fontStep <= 0 || Math.floor(opts.fontStep) !== opts.fontStep) {
    fail(ERROR_CODES.INVALID_OPTIONS,
      'fontStep must be a positive integer, got: ' + opts.fontStep);
  }
  if (opts.minFontSize > opts.maxFontSize) {
    fail(ERROR_CODES.INVALID_OPTIONS,
      'minFontSize (' + opts.minFontSize + ') must not exceed maxFontSize (' +
      opts.maxFontSize + ')');
  }
  if (typeof opts.maxNodes !== 'number' ||
      opts.maxNodes < 1 || opts.maxNodes > MAX_NODES_HARD_CAP ||
      Math.floor(opts.maxNodes) !== opts.maxNodes) {
    fail(ERROR_CODES.INVALID_OPTIONS,
      'maxNodes must be a number in [1, ' + MAX_NODES_HARD_CAP + ']');
  }
  if (opts.width - 2 * opts.padding <= 0 || opts.height - 2 * opts.padding <= 0) {
    fail(ERROR_CODES.INVALID_OPTIONS,
      'padding ' + opts.padding + ' leaves no usable area in a ' +
      opts.width + ' x ' + opts.height + ' canvas');
  }
  return opts;
}

/**
 * Validates and normalizes the raw input tree into a tree of internal nodes.
 * @param {*} input
 * @param {number} maxNodes
 * @return {{root: Object, flat: Array.<Object>, zeroWeightLeaves: Array.<string>,
 *           nodeCount: number, leafCount: number}}
 */
function normalize(input, maxNodes) {
  if (!isPlainObject(input)) {
    fail(ERROR_CODES.EMPTY_INPUT, 'treemap input must be a root node object');
  }
  if (countNodes(input) > maxNodes) {
    fail(ERROR_CODES.NODE_LIMIT, 'treemap exceeds maxNodes=' + maxNodes);
  }

  var flat = [];
  var zeroWeightLeaves = [];
  var seenIds = {};
  var leafCount = 0;

  function walk(raw, parent, depth) {
    if (!isPlainObject(raw)) {
      fail(ERROR_CODES.INVALID_NODE, 'node must be an object');
    }
    var id = raw.id !== undefined ? String(raw.id) : 'node-' + flat.length;
    if (seenIds[id]) {
      fail(ERROR_CODES.INVALID_NODE, 'duplicate node id: ' + id, id);
    }
    seenIds[id] = true;

    var hasChildren = raw.children !== undefined;
    if (hasChildren && !Array.isArray(raw.children)) {
      fail(ERROR_CODES.INVALID_NODE,
        'node "' + id + '" children must be an array', id);
    }
    if (hasChildren && raw.children.length === 0) {
      fail(ERROR_CODES.INVALID_NODE,
        'node "' + id + '" has an empty children array', id);
    }

    var node = {
      id: id,
      name: raw.name !== undefined ? String(raw.name) : id,
      color: raw.color || null,
      depth: depth,
      parent: parent,
      children: [],
      isLeaf: !hasChildren,
      value: 0,
      weight: 0,
      rect: null,
      label: null
    };
    flat.push(node);

    if (hasChildren) {
      for (var i = 0; i < raw.children.length; i++) {
        node.children.push(walk(raw.children[i], node, depth + 1));
      }
      node.weight = node.children.reduce(function(sum, child) {
        return sum + child.weight;
      }, 0);
    } else {
      leafCount++;
      var value = raw.value === undefined ? 0 : raw.value;
      if (typeof value !== 'number' || !isFinite(value)) {
        fail(ERROR_CODES.INVALID_WEIGHT,
          'value must be a finite number, got: ' + value, id);
      }
      if (value < 0) {
        fail(ERROR_CODES.NEGATIVE_WEIGHT,
          'value must be non-negative, got: ' + value, id);
      }
      node.value = value;
      node.weight = value;
      if (value === 0) zeroWeightLeaves.push(id);
    }
    return node;
  }

  var root = walk(input, null, 0);
  return {
    root: root,
    flat: flat,
    zeroWeightLeaves: zeroWeightLeaves,
    nodeCount: flat.length,
    leafCount: leafCount
  };
}

function inset(rect, padding) {
  return {
    x: rect.x + padding,
    y: rect.y + padding,
    width: rect.width - 2 * padding,
    height: rect.height - 2 * padding
  };
}

function tile(items, rect, gap, depth, algorithm) {
  if (algorithm === 'slice-dice') {
    return sliceDice(items, rect, gap, depth);
  }
  return squarify(items, rect, gap);
}

function layoutTree(root, options, labelOptions) {
  var warnings = [];
  var allZeroWeight = root.weight === 0;
  if (allZeroWeight) {
    warnings.push('all nodes have zero weight; nothing can be tiled');
  }

  root.rect = {x: 0, y: 0, width: options.width, height: options.height};

  function place(node, depth) {
    if (node.isLeaf || node.children.length === 0) return;
    var positive = node.children.filter(function(child) { return child.weight > 0; });
    if (positive.length === 0) {
      node.children.forEach(function(child) { child.rect = null; });
      return;
    }
    var content = positive.length === 1
      ? {x: node.rect.x, y: node.rect.y, width: node.rect.width, height: node.rect.height}
      : inset(node.rect, options.padding);
    if (content.width <= 0 || content.height <= 0) {
      positive.forEach(function(child) { child.rect = null; });
      node.children.forEach(function(child) {
        if (child.weight === 0 && child.isLeaf === false) placeZeroSubtree(child);
      });
      return;
    }
    var rects = tile(positive, content, options.gap, depth, options.algorithm);
    positive.forEach(function(child, index) {
      child.rect = rects[index];
      if (!child.isLeaf && child.weight > 0) place(child, depth + 1);
    });
    node.children.forEach(function(child) {
      if (child.weight === 0) {
        child.rect = null;
        if (child.isLeaf === false) placeZeroSubtree(child);
      }
    });
  }

  function placeZeroSubtree(node) {
    node.rect = null;
    node.children.forEach(placeZeroSubtree);
  }

  if (!allZeroWeight) place(root, 0);

  function labelize(node) {
    if (node.rect && !allZeroWeight) {
      node.label = fitLabel(node.name, node.rect, labelOptions);
    } else {
      node.label = null;
    }
    node.children.forEach(labelize);
  }
  labelize(root);

  return warnings;
}

function median(values) {
  if (values.length === 0) return null;
  var sorted = values.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeMetrics(root, flat, options) {
  var leaves = flat.filter(function(node) { return node.isLeaf && node.rect; });
  var ratios = leaves.map(function(node) {
    return Math.max(node.rect.width, node.rect.height) /
      Math.min(node.rect.width, node.rect.height);
  });
  var usableArea = (options.width - 2 * options.padding) *
    (options.height - 2 * options.padding);
  var coveredArea = leaves.reduce(function(sum, node) {
    return sum + node.rect.width * node.rect.height;
  }, 0);
  var voidArea = usableArea - coveredArea;
  var rectNodes = flat.filter(function(node) { return node.rect; });
  var labeledNodes = rectNodes.filter(function(node) { return node.label; });
  var droppedLabels = rectNodes
    .filter(function(node) { return !node.label; })
    .map(function(node) { return node.id; });

  return {
    aspectRatio: {
      min: ratios.length ? Math.min.apply(null, ratios) : null,
      median: median(ratios),
      mean: ratios.length ? ratios.reduce(function(a, b) { return a + b; }, 0) / ratios.length : null,
      max: ratios.length ? Math.max.apply(null, ratios) : null
    },
    usableArea: usableArea,
    coveredArea: coveredArea,
    voidArea: voidArea,
    voidRatio: voidArea / usableArea,
    voidPercent: voidArea / usableArea * 100,
    labelCoverage: rectNodes.length ? labeledNodes.length / rectNodes.length : 0,
    droppedLabels: droppedLabels
  };
}

/**
 * @constructor
 */
function Treemap(input, options) {
  this.options = validateOptions(options || {});
  var normalized = normalize(input, this.options.maxNodes);
  this.root = normalized.root;
  this.flat = normalized.flat;
  this.nodeById = {};
  normalized.flat.forEach(function(node) { this.nodeById[node.id] = node; }, this);
  this.zeroWeightLeaves = normalized.zeroWeightLeaves;
  this.nodeCount = normalized.nodeCount;
  this.leafCount = normalized.leafCount;
  this.allZeroWeight = this.root.weight === 0;
  this.warnings = layoutTree(this.root, this.options, {
    minFontSize: this.options.minFontSize,
    maxFontSize: this.options.maxFontSize,
    fontStep: this.options.fontStep,
    fontFamily: this.options.fontFamily
  });
  this.metrics = computeMetrics(this.root, this.flat, this.options);
}

Treemap.prototype.relayout = function(nodeId, options) {
  var id = String(nodeId);
  var target = this.nodeById[id];
  if (!target) {
    fail(ERROR_CODES.INVALID_NODE, 'relayout target node not found: ' + id, id);
  }
  var rawSubtree = denormalize(target);
  var nextOptions = options || {};
  var merged = {};
  var key;
  for (key in this.options) {
    if (this.options.hasOwnProperty(key)) merged[key] = this.options[key];
  }
  for (key in nextOptions) {
    if (nextOptions.hasOwnProperty(key)) merged[key] = nextOptions[key];
  }
  return new Treemap(rawSubtree, merged);
};

function denormalize(node) {
  var raw = {id: node.id, name: node.name};
  if (node.color) raw.color = node.color;
  if (node.isLeaf) {
    raw.value = node.value;
  } else {
    raw.children = node.children.map(denormalize);
  }
  return raw;
}

function createTreemap(input, options) {
  return new Treemap(input, options);
}

module.exports = {
  createTreemap: createTreemap,
  Treemap: Treemap,
  MAX_NODES_HARD_CAP: MAX_NODES_HARD_CAP
};
