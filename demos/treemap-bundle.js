(function(root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof define === "function" && define.amd) define([], function() { return api; });
  root.acgraph = root.acgraph || {};
  root.acgraph.treemap = api;
})(typeof self !== "undefined" ? self : this, function() {
  "use strict";
  var cache = {};
  var modules = {};
modules["./error.js"] = function(module, exports, require) {
/**
 * @fileoverview Machine-readable error type for the treemap module.
 * Pure CommonJS so it can be loaded in Node directly and wrapped by UMD later.
 */

'use strict';

var ERROR_CODES = {
  EMPTY_INPUT: 'EMPTY_INPUT',
  INVALID_NODE: 'INVALID_NODE',
  INVALID_WEIGHT: 'INVALID_WEIGHT',
  NEGATIVE_WEIGHT: 'NEGATIVE_WEIGHT',
  INVALID_ALGORITHM: 'INVALID_ALGORITHM',
  INVALID_BOUNDS: 'INVALID_BOUNDS',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  NODE_LIMIT: 'NODE_LIMIT'
};

/**
 * Error carrying a stable machine-readable code and an optional node id.
 * @constructor
 * @param {string} code One of ERROR_CODES.
 * @param {string} message Human readable message.
 * @param {string=} nodeId Id of the offending node, when applicable.
 * @extends {Error}
 */
function TreemapError(code, message, nodeId) {
  this.name = 'TreemapError';
  this.code = code;
  this.message = message;
  if (nodeId !== undefined && nodeId !== null) {
    this.nodeId = nodeId;
  }
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, TreemapError);
  } else {
    this.stack = (new Error(message)).stack;
  }
}
TreemapError.prototype = Object.create(Error.prototype);
TreemapError.prototype.constructor = TreemapError;

module.exports = {
  TreemapError: TreemapError,
  ERROR_CODES: ERROR_CODES
};

};
modules["./label.js"] = function(module, exports, require) {
/**
 * @fileoverview Deterministic, DOM-free text measurement and the label
 * fitting pipeline: shrink font size, then word wrap, then ellipsize,
 * then drop. A dropped label is the only possible outcome when text does
 * not fit, so labels can never overflow their rectangle.
 */

'use strict';

var LINE_HEIGHT_FACTOR = 1.2;
var TEXT_PADDING_X = 4;
var TEXT_PADDING_Y = 2;

/**
 * Average glyph advance width as a fraction of font size. Keyed by the
 * first character class; deliberately coarse but fully deterministic so
 * Node and every browser compute identical layouts.
 * @const {Object.<string, number>}
 */
var CHAR_WIDTH_FACTOR = {
  space: 0.3,
  upper: 0.7,
  digit: 0.56,
  narrow: 0.3,
  wide: 0.85,
  mid: 0.38,
  normal: 0.55,
  punctuation: 0.45
};

/**
 * @param {string} ch
 * @return {string}
 */
function charClass(ch) {
  if (ch === ' ') return 'space';
  if (ch >= 'A' && ch <= 'Z') return 'upper';
  if (ch >= '0' && ch <= '9') return 'digit';
  if (ch === 'i' || ch === 'l' || ch === 'j') return 'narrow';
  if (ch === 'm' || ch === 'w') return 'wide';
  if (ch === 'f' || ch === 'r' || ch === 't') return 'mid';
  if ((ch >= 'a' && ch <= 'z')) return 'normal';
  return 'punctuation';
}

/**
 * Measures a single-line string at a given font size.
 * @param {string} text
 * @param {number} fontSize
 * @return {number}
 */
function measureText(text, fontSize) {
  var width = 0;
  for (var i = 0; i < text.length; i++) {
    width += CHAR_WIDTH_FACTOR[charClass(text.charAt(i))] * fontSize;
  }
  return width;
}

/**
 * Greedy word wrap. Words never break in this stage.
 * @param {string} text
 * @param {number} fontSize
 * @param {number} maxWidth
 * @return {Array.<string>}
 */
function wrapWords(text, fontSize, maxWidth) {
  var words = text.split(' ');
  var lines = [];
  var current = '';
  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    var candidate = current ? current + ' ' + word : word;
    if (measureText(candidate, fontSize) <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Ellipsizing layout used once no font size can fit the full text. Words
 * may be clipped mid-word; the clipped token gets a trailing ellipsis.
 * Returns null when not even one clipped line fits.
 * @param {string} text
 * @param {number} fontSize
 * @param {number} maxWidth
 * @param {number} maxLines
 * @return {{lines: Array.<string>, ellipsized: boolean}?}
 */
function wrapWithEllipsis(text, fontSize, maxWidth, maxLines) {
  var ellipsis = '…';
  var ellipsisWidth = measureText(ellipsis, fontSize);
  if (ellipsisWidth > maxWidth || maxLines < 1) return null;

  var words = text.split(' ');
  var lines = [];
  var current = '';
  var ellipsized = false;

  function clipWord(word) {
    var clipped = '';
    for (var k = 0; k < word.length; k++) {
      if (measureText(clipped + word.charAt(k) + ellipsis, fontSize) <= maxWidth) {
        clipped += word.charAt(k);
      } else {
        break;
      }
    }
    return clipped ? clipped + ellipsis : null;
  }

  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    var candidate = current ? current + ' ' + word : word;
    if (measureText(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      var clippedLine = current ? current + ' ' + ellipsis : clipWord(word);
      if (clippedLine && measureText(clippedLine, fontSize) <= maxWidth) {
        current = clippedLine;
        ellipsized = true;
        break;
      }
      if (!current) {
        current = clipWord(word);
        if (!current) return null;
        ellipsized = true;
        break;
      }
      current = current + ellipsis;
      ellipsized = true;
      break;
    }
    if (current) lines.push(current);
    if (measureText(word, fontSize) <= maxWidth) {
      current = word;
    } else {
      current = clipWord(word);
      if (!current) return null;
      ellipsized = true;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) return null;
  return {lines: lines, ellipsized: ellipsized};
}

/**
 * Fits a label inside a rectangle.
 * @param {string} text
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {{minFontSize:number,maxFontSize:number,fontStep:number,fontFamily:string}} options
 * @return {{fontSize:number,lines:Array.<string>,ellipsized:boolean,dropped:boolean,
 *           lineHeight:number,textPadding:number}|null} null means the label
 *           is dropped, which never overflows.
 */
function fitLabel(text, rect, options) {
  if (!text || !rect || rect.width <= 2 * TEXT_PADDING_X ||
      rect.height <= 2 * TEXT_PADDING_Y) {
    return null;
  }
  var maxWidth = rect.width - 2 * TEXT_PADDING_X;
  var maxHeight = rect.height - 2 * TEXT_PADDING_Y;

  var step = options.fontStep || 1;
  for (var size = options.maxFontSize; size >= options.minFontSize; size -= step) {
    var lineHeight = size * LINE_HEIGHT_FACTOR;
    var lines = wrapWords(text, size, maxWidth);
    if (lines.length * lineHeight <= maxHeight &&
        lines.every(function(line) { return measureText(line, size) <= maxWidth; })) {
      return {
        fontSize: size,
        lines: lines,
        ellipsized: false,
        dropped: false,
        lineHeight: lineHeight,
        textPadding: TEXT_PADDING_X
      };
    }
  }

  var minSize = options.minFontSize;
  var minLineHeight = minSize * LINE_HEIGHT_FACTOR;
  var maxLines = Math.max(1, Math.floor(maxHeight / minLineHeight));
  var clipped = wrapWithEllipsis(text, minSize, maxWidth, maxLines);
  if (!clipped) return null;
  return {
    fontSize: minSize,
    lines: clipped.lines,
    ellipsized: clipped.ellipsized,
    dropped: false,
    lineHeight: minLineHeight,
    textPadding: TEXT_PADDING_X
  };
}

module.exports = {
  LINE_HEIGHT_FACTOR: LINE_HEIGHT_FACTOR,
  TEXT_PADDING_X: TEXT_PADDING_X,
  TEXT_PADDING_Y: TEXT_PADDING_Y,
  measureText: measureText,
  fitLabel: fitLabel
};

};
modules["./Squarify.js"] = function(module, exports, require) {
/**
 * @fileoverview Gap-aware squarified treemap tiling (Bruls, Huizing, van Wijk,
 * 2000). Items are sorted by descending weight, packed into rows along the
 * shortest edge of the remaining rectangle, and a row is fixed once adding the
 * next item would worsen its worst aspect ratio.
 */

'use strict';

/**
 * Worst aspect ratio of a row of items laid out inside a strip.
 * @param {number} stripLength Length of the fixed edge.
 * @param {number} rowWeight Total row weight.
 * @param {number} stripWeight Total weight of the strip (full area).
 * @param {Array.<number>} itemWeights
 * @return {number}
 */
function worstRatio(stripLength, rowWeight, stripWeight, itemWeights) {
  var stripBreadth = rowWeight / stripWeight * stripLength;
  var worst = 0;
  for (var i = 0; i < itemWeights.length; i++) {
    var itemBreadth = itemWeights[i] / rowWeight * stripBreadth;
    var ratio = Math.max(stripBreadth / itemBreadth, itemBreadth / stripBreadth);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/**
 * Splits a rectangle among weighted items with the squarified algorithm.
 * @param {Array.<{weight:number}>} items Positive-weight items, in render order.
 * @param {{x:number,y:number,width:number,height:number}} rect Available area.
 * @param {number} gap Gap between sibling rectangles, in pixels.
 * @return {Array.<{x:number,y:number,width:number,height:number}>} One rect per
 *     input item (same order).
 */
function squarify(items, rect, gap) {
  var ordered = items
    .map(function(item, index) { return {index: index, weight: item.weight}; })
    .sort(function(a, b) { return b.weight - a.weight; });
  var remainingWeight = ordered.reduce(function(sum, item) { return sum + item.weight; }, 0);
  var area = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    weight: remainingWeight
  };
  var placed = new Array(items.length);
  var cursor = 0;

  while (cursor < ordered.length) {
    var lastRow = ordered.length - 1;
    var horizontal = area.width >= area.height;
    var fixedEdge = horizontal ? area.height : area.width;
    var row = [];
    var rowIndices = [];
    while (cursor <= lastRow) {
      var candidate = row.concat([ordered[cursor].weight]);
      if (row.length === 0 ||
          worstRatio(fixedEdge, sum(candidate), area.weight, candidate) <=
          worstRatio(fixedEdge, sum(row), area.weight, row)) {
        row.push(ordered[cursor].weight);
        rowIndices.push(cursor);
        cursor++;
      } else {
        break;
      }
    }

    var rowWeight = sum(row);
    var stripBreadth = rowWeight / area.weight *
      (horizontal ? area.width : area.height);
    if (cursor > lastRow) {
      stripBreadth = horizontal ? area.width : area.height;
    }
    var offset = 0;
    for (var k = 0; k < row.length; k++) {
      var itemBreadth;
      var gapBudget = (row.length - 1) * gap;
      if (row.length === 1) {
        itemBreadth = fixedEdge;
      } else if (k === row.length - 1) {
        itemBreadth = fixedEdge - offset - gapBudget;
      } else {
        itemBreadth = row[k] / rowWeight * (stripBreadth - gapBudget);
      }
      if (itemBreadth < 0) itemBreadth = 0;
      var itemIndex = ordered[rowIndices[k]].index;
      if (horizontal) {
        placed[itemIndex] = {
          x: area.x,
          y: area.y + offset,
          width: stripBreadth,
          height: itemBreadth
        };
      } else {
        placed[itemIndex] = {
          x: area.x + offset,
          y: area.y,
          width: itemBreadth,
          height: stripBreadth
        };
      }
      offset += itemBreadth + gap;
    }

    if (horizontal) {
      area = {
        x: area.x + stripBreadth + gap,
        y: area.y,
        width: area.width - stripBreadth - gap,
        height: area.height,
        weight: area.weight - rowWeight
      };
    } else {
      area = {
        x: area.x,
        y: area.y + stripBreadth + gap,
        width: area.width,
        height: area.height - stripBreadth - gap,
        weight: area.weight - rowWeight
      };
    }
  }
  return placed;
}

function sum(values) {
  return values.reduce(function(total, value) { return total + value; }, 0);
}

module.exports = {squarify: squarify};

};
modules["./SliceDice.js"] = function(module, exports, require) {
/**
 * @fileoverview Slice-and-dice tiling. The split direction alternates with
 * depth: even depths dice horizontally (rows), odd depths slice vertically
 * (columns). Each child gets a strip proportional to its weight; the final
 * child absorbs rounding and gap remainder so strips always tile the full
 * rectangle.
 */

'use strict';

/**
 * @param {Array.<{weight:number}>} items Positive-weight items, render order.
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {number} gap
 * @param {number} depth 0-based depth of the split inside the tree.
 * @return {Array.<{x:number,y:number,width:number,height:number}>}
 */
function sliceDice(items, rect, gap, depth) {
  var totalWeight = items.reduce(function(sum, item) { return sum + item.weight; }, 0);
  var horizontal = depth % 2 === 0;
  var fixedLength = horizontal ? rect.height : rect.width;
  var usableLength = fixedLength - (items.length - 1) * gap;
  var placed = new Array(items.length);
  var offset = 0;

  for (var i = 0; i < items.length; i++) {
    var length = i === items.length - 1
      ? Math.max(0, usableLength - offset)
      : items[i].weight / totalWeight * usableLength;
    if (length < 0) length = 0;
    if (horizontal) {
      placed[i] = {x: rect.x, y: rect.y + offset, width: rect.width, height: length};
    } else {
      placed[i] = {x: rect.x + offset, y: rect.y, width: length, height: rect.height};
    }
    offset += length + gap;
  }
  return placed;
}

module.exports = {sliceDice: sliceDice};

};
modules["./Treemap.js"] = function(module, exports, require) {
/**
 * @fileoverview Treemap engine: input validation, tree normalization with
 * weight aggregation, recursive gap-aware layout, drill-down relayout and
 * geometry metrics. Tiling algorithms are pluggable.
 */

'use strict';

var TreemapError = require('./error.js').TreemapError;
var ERROR_CODES = require('./error.js').ERROR_CODES;
var squarify = require('./Squarify.js').squarify;
var sliceDice = require('./SliceDice.js').sliceDice;
var fitLabel = require('./label.js').fitLabel;

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

};
modules["./Renderer.js"] = function(module, exports, require) {
/**
 * @fileoverview Two rendering paths for a Treemap:
 * 1. renderToSvg: deterministic, DOM-free SVG string (byte-identical across
 *    runs, module systems and platforms);
 * 2. renderToStage: draws into an existing acgraph Stage via its public API,
 *    without touching any acgraph internals.
 */

'use strict';

function round2(value) {
  return Math.round(value * 100) / 100;
}

function fmt(value) {
  var rounded = round2(value);
  return String(rounded);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baselineY(rect, label, lineIndex) {
  var blockHeight = label.lines.length * label.lineHeight;
  var top = rect.y + (rect.height - blockHeight) / 2;
  return top + lineIndex * label.lineHeight + label.fontSize * 0.8;
}

/**
 * Renders the treemap as a deterministic SVG string.
 * @param {Object} treemap A Treemap instance.
 * @return {string}
 */
function renderToSvg(treemap) {
  var options = treemap.options;
  var lines = [];
  lines.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + options.width +
    '" height="' + options.height + '" viewBox="0 0 ' + options.width + ' ' +
    options.height + '">');

  if (treemap.allZeroWeight) {
    var cx = options.width / 2;
    var cy = options.height / 2;
    lines.push('  <text font-family="sans-serif" font-size="18" fill="#333333" ' +
      'text-anchor="middle">');
    lines.push('    <tspan x="' + fmt(cx) + '" y="' + fmt(cy + 6) + '">' +
      escapeXml('No data (all weights are zero)') + '</tspan>');
    lines.push('  </text>');
    lines.push('</svg>');
    return lines.join('\n') + '\n';
  }

  treemap.flat.forEach(function(node) {
    if (!node.rect) return;
    var fill = node.isLeaf && node.color ? node.color : 'none';
    var stroke = node.isLeaf && node.color ? '#ffffff' : '#333333';
    lines.push('  <rect data-id="' + escapeXml(node.id) + '" x="' +
      fmt(node.rect.x) + '" y="' + fmt(node.rect.y) + '" width="' +
      fmt(node.rect.width) + '" height="' + fmt(node.rect.height) +
      '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>');
  });

  treemap.flat.forEach(function(node) {
    if (!node.rect || !node.label) return;
    var label = node.label;
    var centerX = node.rect.x + node.rect.width / 2;
    lines.push('  <text data-id="' + escapeXml(node.id) + '" font-family="' +
      options.fontFamily + '" font-size="' + label.fontSize +
      '" fill="#ffffff" text-anchor="middle">');
    for (var i = 0; i < label.lines.length; i++) {
      lines.push('    <tspan x="' + fmt(centerX) + '" y="' +
        fmt(baselineY(node.rect, label, i)) + '">' +
        escapeXml(label.lines[i]) + '</tspan>');
    }
    lines.push('  </text>');
  });

  lines.push('</svg>');
  return lines.join('\n') + '\n';
}

/**
 * Draws the treemap into an acgraph Stage. Only the documented public API
 * (stage.rect / stage.text / chaining setters) is used.
 * @param {Object} treemap
 * @param {Object} stage acgraph Stage instance.
 * @return {Object} The same stage, for chaining.
 */
function renderToStage(treemap, stage) {
  if (!stage || typeof stage.rect !== 'function' || typeof stage.text !== 'function') {
    throw new TypeError('renderToStage requires an acgraph Stage');
  }
  if (treemap.allZeroWeight) {
    stage.text(treemap.options.width / 2, treemap.options.height / 2)
      .text('No data (all weights are zero)')
      .fontSize(18)
      .color('#333333');
    return stage;
  }
  treemap.flat.forEach(function(node) {
    if (!node.rect) return;
    var fill = node.isLeaf && node.color ? node.color : 'none';
    var stroke = node.isLeaf && node.color ? '#ffffff' : '#333333';
    stage.rect(node.rect.x, node.rect.y, node.rect.width, node.rect.height)
      .fill(fill)
      .stroke(stroke, 1);
  });
  treemap.flat.forEach(function(node) {
    if (!node.rect || !node.label) return;
    var label = node.label;
    var centerX = node.rect.x + node.rect.width / 2;
    var text = stage.text(centerX, baselineY(node.rect, label, 0))
      .text(label.lines.join('\n'))
      .fontSize(label.fontSize)
      .color('#ffffff');
    if (typeof text.anchor === 'function') {
      text.anchor('middle');
    }
  });
  return stage;
}

module.exports = {
  renderToSvg: renderToSvg,
  renderToStage: renderToStage,
  baselineY: baselineY,
  round2: round2
};

};
modules["./index.js"] = function(module, exports, require) {
/**
 * @fileoverview Public entry point for acgraph.treemap. Zero-dependency UMD:
 * works as CommonJS/Node, AMD, and a browser global that attaches to the
 * existing acgraph object without modifying any of its keys.
 */

(function(root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof define === 'function' && define.amd) {
    define([], function() { return api; });
  }
  if (typeof root === 'object' && root) {
    root.acgraph = root.acgraph || {};
    root.acgraph.treemap = api;
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var TreemapModule = require('./Treemap.js');
  var Renderer = require('./Renderer.js');
  var ErrorModule = require('./error.js');

  return {
    createTreemap: TreemapModule.createTreemap,
    Treemap: TreemapModule.Treemap,
    renderToSvg: Renderer.renderToSvg,
    renderToStage: Renderer.renderToStage,
    TreemapError: ErrorModule.TreemapError,
    ERROR_CODES: ErrorModule.ERROR_CODES,
    MAX_NODES_HARD_CAP: TreemapModule.MAX_NODES_HARD_CAP,
    algorithms: {
      squarify: 'squarify',
      'slice-dice': 'slice-dice'
    }
  };
});

};
  function require(id) {
    if (cache[id]) return cache[id].exports;
    if (!modules[id]) throw new Error("treemap bundle: unknown module " + id);
    var record = cache[id] = {exports: {}};
    modules[id](record, record.exports, require);
    return record.exports;
  }
  return require("./index.js");
});
