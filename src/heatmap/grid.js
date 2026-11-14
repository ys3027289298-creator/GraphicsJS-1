/**
 * @fileoverview Data-space grid aggregation for the heatmap.
 *
 * Responsibilities:
 *  1. Bin arbitrary (x, y, value) points onto a fixed rows x cols grid using a
 *     configurable aggregation function (sum by default; mean/count/min/max or
 *     a custom function also supported).
 *  2. Track which cells actually received data so sparse inputs never leave
 *     visual holes: empty cells are rendered with an explicit, configurable
 *     "empty" appearance instead of being skipped or painted black.
 *  3. Normalize aggregated values against a stable numeric domain. The domain
 *     is derived once from the data (or supplied explicitly) and never changes
 *     when the viewport is zoomed, so color mapping stays identical after
 *     scaling.
 *
 * No runtime dependencies, safe to require() from Node.js.
 *
 * @suppress {underscore}
 */

var globalScope = typeof globalThis !== 'undefined' ? globalThis :
    (typeof window !== 'undefined' ? window : this);
var acgraph = globalScope.acgraph = globalScope.acgraph || {};
acgraph.heatmap = acgraph.heatmap || {};


/**
 * Built-in aggregation reducers. Each receives the list of values inside one
 * cell. count ignores values and reports the number of points.
 * @enum {string}
 */
acgraph.heatmap.Aggregation = {
  SUM: 'sum',
  MEAN: 'mean',
  COUNT: 'count',
  MIN: 'min',
  MAX: 'max'
};


/**
 * @param {string|function(!Array<number>):number} aggregation
 * @return {function(!Array<number>):number}
 * @private
 */
acgraph.heatmap.resolveReducer_ = function(aggregation) {
  if (typeof aggregation === 'function') return aggregation;
  switch (aggregation) {
    case acgraph.heatmap.Aggregation.MEAN:
      return function(values) {
        var total = 0;
        for (var i = 0; i < values.length; i++) total += values[i];
        return total / values.length;
      };
    case acgraph.heatmap.Aggregation.COUNT:
      return function(values) { return values.length; };
    case acgraph.heatmap.Aggregation.MIN:
      return function(values) { return Math.min.apply(null, values); };
    case acgraph.heatmap.Aggregation.MAX:
      return function(values) { return Math.max.apply(null, values); };
    case acgraph.heatmap.Aggregation.SUM:
    case null:
    case undefined:
      return function(values) {
        var total = 0;
        for (var i = 0; i < values.length; i++) total += values[i];
        return total;
      };
    default:
      throw new Error('Unknown aggregation: ' + aggregation);
  }
};


/**
 * Aggregated heatmap grid.
 *
 * Configuration:
 *  rows, cols          : grid resolution (positive integers)
 *  aggregation         : 'sum' | 'mean' | 'count' | 'min' | 'max' | function
 *  domain              : explicit [min, max]; auto-derived when omitted
 *  bounds              : explicit data-space {minX, minY, maxX, maxY};
 *                        auto-derived from the points when omitted
 *  fillEmpty           : when true (default) every cell gets a render record,
 *                        empty cells carrying value=null
 *
 * @param {!{rows:(number|undefined), cols:(number|undefined),
 *           aggregation:(*|undefined), domain:(!Array<number>|undefined),
 *           bounds:(!{minX:number,minY:number,maxX:number,maxY:number}|undefined),
 *           fillEmpty:(boolean|undefined)}} opt_config
 * @constructor
 */
acgraph.heatmap.Grid = function(opt_config) {
  var config = opt_config || {};
  var rows = config.rows == null ? 10 : Math.floor(config.rows);
  var cols = config.cols == null ? 10 : Math.floor(config.cols);
  if (!(rows > 0) || !(cols > 0)) throw new Error('Grid rows/cols must be positive integers');

  /** @type {number} */
  this.rows = rows;
  /** @type {number} */
  this.cols = cols;
  /** @private {function(!Array<number>):number} */
  this.reducer_ = acgraph.heatmap.resolveReducer_(config.aggregation);
  /** @type {?Array<number>} */
  this.explicitDomain = config.domain ? config.domain.slice() : null;
  /** @type {?{minX:number,minY:number,maxX:number,maxY:number}} */
  this.bounds = config.bounds ? acgraph.heatmap.Grid.cloneBounds_(config.bounds) : null;
  /** @type {boolean} */
  this.fillEmpty = config.fillEmpty !== false;

  /**
   * Rows x cols matrix; null means the cell received no point.
   * @type {!Array<?number>}
   */
  this.values = new Array(rows * cols).fill(null);
  /**
   * Number of raw points binned into each cell.
   * @type {!Array<number>}
   */
  this.counts = new Array(rows * cols).fill(0);
  /** @type {number} */
  this.pointCount = 0;
  /** @type {?Array<number>} resolved [min, max] after fit() */
  this.domain = null;
  /** @private {!Array<!Array<number>>} raw values per cell, cleared after fit */
  this.buckets_ = new Array(rows * cols);
};


/**
 * @param {!{minX:number,minY:number,maxX:number,maxY:number}} bounds
 * @return {!{minX:number,minY:number,maxX:number,maxY:number}}
 * @private
 */
acgraph.heatmap.Grid.cloneBounds_ = function(bounds) {
  return {minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY};
};


/**
 * Validates one input point.
 * @param {{x:number, y:number, value:(number|undefined)}} point
 * @private
 */
acgraph.heatmap.Grid.checkPoint_ = function(point) {
  if (!point || typeof point !== 'object') throw new Error('Each point must be an object with x and y');
  if (typeof point.x !== 'number' || typeof point.y !== 'number' || isNaN(point.x) || isNaN(point.y)) {
    throw new Error('Point x and y must be finite numbers');
  }
  if (point.value != null && (typeof point.value !== 'number' || isNaN(point.value))) {
    throw new Error('Point value must be a finite number when provided');
  }
};


/**
 * Adds a batch of points. Bounds are extended as needed before binning.
 * @param {!Array<!{x:number, y:number, value:(number|undefined)}>} points
 * @return {!acgraph.heatmap.Grid}
 */
acgraph.heatmap.Grid.prototype.addPoints = function(points) {
  if (!Array.isArray(points)) throw new Error('addPoints expects an array');
  for (var i = 0; i < points.length; i++) {
    var point = points[i];
    acgraph.heatmap.Grid.checkPoint_(point);
    if (!this.bounds) {
      this.bounds = {minX: point.x, maxX: point.x, minY: point.y, maxY: point.y};
    } else {
      if (point.x < this.bounds.minX) this.bounds.minX = point.x;
      if (point.x > this.bounds.maxX) this.bounds.maxX = point.x;
      if (point.y < this.bounds.minY) this.bounds.minY = point.y;
      if (point.y > this.bounds.maxY) this.bounds.maxY = point.y;
    }
  }
  for (var j = 0; j < points.length; j++) this.binPoint_(points[j]);
  this.pointCount += points.length;
  return this;
};


/**
 * @param {{x:number, y:number, value:(number|undefined)}} point
 * @private
 */
acgraph.heatmap.Grid.prototype.binPoint_ = function(point) {
  var bounds = this.bounds;
  var col = acgraph.heatmap.Grid.binIndex_(point.x, bounds.minX, bounds.maxX, this.cols);
  var row = acgraph.heatmap.Grid.binIndex_(point.y, bounds.minY, bounds.maxY, this.rows);
  var index = row * this.cols + col;
  var value = point.value == null ? 1 : point.value;
  if (!this.buckets_[index]) this.buckets_[index] = [];
  this.buckets_[index].push(value);
  this.counts[index]++;
};


/**
 * Maps a coordinate onto a bin index in [0, size-1]. The upper boundary maps
 * onto the last bin so boundary points are never lost.
 * @param {number} coordinate
 * @param {number} min
 * @param {number} max
 * @param {number} size
 * @return {number}
 * @private
 */
acgraph.heatmap.Grid.binIndex_ = function(coordinate, min, max, size) {
  if (max === min) return 0;
  var index = Math.floor((coordinate - min) / (max - min) * size);
  if (index >= size) return size - 1;
  if (index < 0) return 0;
  return index;
};


/**
 * Reduces every occupied bucket and resolves the normalization domain.
 * Must be called once after all points have been added.
 * @return {!acgraph.heatmap.Grid}
 */
acgraph.heatmap.Grid.prototype.fit = function() {
  var min = Infinity;
  var max = -Infinity;
  for (var i = 0; i < this.buckets_.length; i++) {
    var bucket = this.buckets_[i];
    if (!bucket || !bucket.length) continue;
    var reduced = this.reducer_(bucket);
    if (typeof reduced !== 'number' || isNaN(reduced)) throw new Error('Aggregation must produce a finite number');
    this.values[i] = reduced;
    if (reduced < min) min = reduced;
    if (reduced > max) max = reduced;
  }
  this.buckets_ = new Array(this.rows * this.cols);

  if (this.explicitDomain) {
    this.domain = [this.explicitDomain[0], this.explicitDomain[1]];
  } else if (isFinite(min)) {
    this.domain = [min, max];
  } else {
    this.domain = [0, 0];
  }
  if (!(this.domain[1] >= this.domain[0])) throw new Error('Color domain must be ordered [min, max]');
  return this;
};


/**
 * Normalizes a value against the resolved domain. A zero-span domain returns
 * 0 for every value instead of producing NaN/Infinity (the all-zero case).
 * @param {number} value
 * @return {number}
 */
acgraph.heatmap.Grid.prototype.normalize = function(value) {
  if (!this.domain) throw new Error('Grid must be fit() before normalize()');
  var span = this.domain[1] - this.domain[0];
  if (span === 0) return 0;
  var t = (value - this.domain[0]) / span;
  return t < 0 ? 0 : (t > 1 ? 1 : t);
};


/**
 * Emits one render descriptor per cell. Empty cells are included when
 * fillEmpty is enabled so the renderer never leaves transparent/black holes.
 *
 * Descriptor: {row, col, index, value:?number, count:number, t:?number,
 *              empty:boolean}
 *
 * @return {!Array<!{row:number, col:number, index:number, value:?number,
 *                   count:number, t:?number, empty:boolean}>}
 */
acgraph.heatmap.Grid.prototype.cellDescriptors = function() {
  if (!this.domain) throw new Error('Grid must be fit() before cellDescriptors()');
  var descriptors = [];
  for (var row = 0; row < this.rows; row++) {
    for (var col = 0; col < this.cols; col++) {
      var index = row * this.cols + col;
      var value = this.values[index];
      var empty = value == null;
      if (empty && !this.fillEmpty) continue;
      descriptors.push({
        row: row,
        col: col,
        index: index,
        value: value,
        count: this.counts[index],
        t: empty ? null : this.normalize(value),
        empty: empty
      });
    }
  }
  return descriptors;
};


/**
 * Number of cells occupied by at least one point.
 * @return {number}
 */
acgraph.heatmap.Grid.prototype.occupiedCells = function() {
  var occupied = 0;
  for (var i = 0; i < this.values.length; i++) if (this.values[i] != null) occupied++;
  return occupied;
};


if (typeof module !== 'undefined' && module.exports) {
  module.exports = acgraph.heatmap.Grid;
}
