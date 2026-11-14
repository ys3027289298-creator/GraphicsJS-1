/**
 * @fileoverview Heatmap rendering layer.
 *
 * Two pieces:
 *  1. acgraph.heatmap.buildRenderPlan() — pure function turning a fitted Grid
 *     plus view geometry into deterministic cell descriptors with pixel rects
 *     and resolved css colors. No DOM access, so it runs in Node and is the
 *     basis of pixel/byte-level verification.
 *  2. acgraph.heatmap.Heatmap — thin facade that draws the plan through
 *     acgraph rect primitives (SVG/VML), keeping every existing chart type
 *     untouched.
 *
 * Color resolution happens in data space: the normalized t value (and
 * therefore the fill color) is computed by the Grid once and simply reused for
 * any viewport size. Zooming changes pixel geometry only, never the mapping.
 *
 * @suppress {underscore}
 */

var globalScope = typeof globalThis !== 'undefined' ? globalThis :
    (typeof window !== 'undefined' ? window : this);
var acgraph = globalScope.acgraph = globalScope.acgraph || {};
acgraph.heatmap = acgraph.heatmap || {};


/**
 * Explicit, non-black appearance used for cells that carry no data and for the
 * degenerate empty / all-zero datasets. Both are distinguishable:
 *  - empty cells / no data  -> configurable emptyColor (default light gray)
 *  - all-zero cells          -> the zero end of the color scale (by construction
 *                               when 0 is the domain minimum)
 *
 * @enum {string}
 */
acgraph.heatmap.SpecialState = {
  EMPTY: 'empty',
  NO_DATA: 'no-data',
  ZERO_SPAN: 'zero-span'
};


/**
 * Builds a deterministic render plan.
 *
 * @param {!acgraph.heatmap.Grid} grid            a fitted grid
 * @param {!{x:number, y:number, width:number, height:number}} view
 *        pixel rectangle the grid occupies
 * @param {!acgraph.heatmap.ColorScale} colorScale
 * @param {!{emptyColor:(string|undefined),
 *           noDataColor:(string|undefined),
 *           stroke:(string|undefined),
 *           strokeThickness:(number|undefined)}=} opt_options
 * @return {!{view:!{x:number,y:number,width:number,height:number},
 *            cellWidth:number, cellHeight:number,
 *            emptyColor:string, noDataColor:string,
 *            stroke:?string, strokeThickness:number,
 *            state:string,
 *            cells:!Array<!{row:number, col:number, x:number, y:number,
 *                            width:number, height:number, color:string,
 *                            value:?number, t:?number, empty:boolean,
 *                            special:?string}>}}
 */
acgraph.heatmap.buildRenderPlan = function(grid, view, colorScale, opt_options) {
  if (!grid.domain) throw new Error('Grid must be fit() before building a render plan');
  if (!view || !(view.width > 0) || !(view.height > 0)) {
    throw new Error('View must define a positive width and height');
  }
  var options = opt_options || {};
  var emptyColor = options.emptyColor || '#e8e8e8';
  var noDataColor = options.noDataColor || '#f5f5f5';
  var cellWidth = view.width / grid.cols;
  var cellHeight = view.height / grid.rows;

  var state;
  if (grid.pointCount === 0) {
    state = acgraph.heatmap.SpecialState.NO_DATA;
  } else if (grid.domain[1] - grid.domain[0] === 0) {
    state = acgraph.heatmap.SpecialState.ZERO_SPAN;
  } else {
    state = 'normal';
  }

  var cells = grid.cellDescriptors().map(function(descriptor) {
    var x = view.x + descriptor.col * cellWidth;
    var y = view.y + descriptor.row * cellHeight;
    var color;
    var special = null;
    if (state === acgraph.heatmap.SpecialState.NO_DATA) {
      color = noDataColor;
      special = state;
    } else if (descriptor.empty) {
      color = emptyColor;
      special = acgraph.heatmap.SpecialState.EMPTY;
    } else if (state === acgraph.heatmap.SpecialState.ZERO_SPAN) {
      color = colorScale.colorAt(0);
      special = state;
    } else {
      color = colorScale.colorAt(/** @type {number} */ (descriptor.t));
    }
    return {
      row: descriptor.row,
      col: descriptor.col,
      x: x,
      y: y,
      width: cellWidth,
      height: cellHeight,
      color: color,
      value: descriptor.value,
      t: descriptor.t,
      empty: descriptor.empty,
      special: special
    };
  });

  return {
    view: {x: view.x, y: view.y, width: view.width, height: view.height},
    cellWidth: cellWidth,
    cellHeight: cellHeight,
    emptyColor: emptyColor,
    noDataColor: noDataColor,
    stroke: options.stroke == null ? null : options.stroke,
    strokeThickness: options.strokeThickness == null ? 0 : options.strokeThickness,
    state: state,
    cells: cells
  };
};


/**
 * High-level heatmap facade: owns a grid, a color scale and view geometry and
 * draws itself onto any acgraph layer/stage.
 *
 * @param {!{rows:(number|undefined), cols:(number|undefined),
 *           aggregation:(*|undefined), domain:(!Array<number>|undefined),
 *           bounds:(!Object|undefined), fillEmpty:(boolean|undefined),
 *           colorStops:(!Array|undefined),
 *           emptyColor:(string|undefined), noDataColor:(string|undefined),
 *           stroke:(string|undefined), strokeThickness:(number|undefined)}} opt_config
 * @constructor
 */
acgraph.heatmap.Heatmap = function(opt_config) {
  var config = opt_config || {};
  /** @type {!acgraph.heatmap.Grid} */
  this.grid = new acgraph.heatmap.Grid(config);
  /** @type {!acgraph.heatmap.ColorScale} */
  this.colorScale = new acgraph.heatmap.ColorScale(config.colorStops);
  /** @type {string} */
  this.emptyColor = config.emptyColor || '#e8e8e8';
  /** @type {string} */
  this.noDataColor = config.noDataColor || '#f5f5f5';
  /** @type {?string} */
  this.stroke = config.stroke == null ? null : config.stroke;
  /** @type {number} */
  this.strokeThickness = config.strokeThickness == null ? 0 : config.strokeThickness;
  /** @type {?{x:number,y:number,width:number,height:number}} */
  this.view = null;
  /** @type {?Object} */
  this.plan = null;
};


/**
 * Feeds data and resolves the domain.
 * @param {!Array<!{x:number, y:number, value:(number|undefined)}>} points
 * @return {!acgraph.heatmap.Heatmap}
 */
acgraph.heatmap.Heatmap.prototype.setData = function(points) {
  this.grid.addPoints(points);
  this.grid.fit();
  this.plan = null;
  return this;
};


/**
 * Sets the pixel rectangle occupied by the heatmap. Re-calling this with a
 * larger/smaller rectangle (zoom) only changes geometry; the grid, domain and
 * normalized colors remain untouched.
 * @param {!{x:number, y:number, width:number, height:number}} view
 * @return {!acgraph.heatmap.Heatmap}
 */
acgraph.heatmap.Heatmap.prototype.setView = function(view) {
  this.view = {x: view.x, y: view.y, width: view.width, height: view.height};
  this.plan = null;
  return this;
};


/**
 * Returns the render plan, rebuilding it when data or view changed.
 * @return {!Object}
 */
acgraph.heatmap.Heatmap.prototype.getRenderPlan = function() {
  if (!this.view) throw new Error('Call setView() before rendering');
  if (!this.plan) {
    this.plan = acgraph.heatmap.buildRenderPlan(this.grid, this.view, this.colorScale, {
      emptyColor: this.emptyColor,
      noDataColor: this.noDataColor,
      stroke: this.stroke,
      strokeThickness: this.strokeThickness
    });
  }
  return this.plan;
};


/**
 * Draws the heatmap onto an acgraph layer (or stage root layer).
 * @param {!Object} layer  acgraph.vector.ILayer
 * @return {!Object} the layer, for chaining
 */
acgraph.heatmap.Heatmap.prototype.renderTo = function(layer) {
  var plan = this.getRenderPlan();
  for (var i = 0; i < plan.cells.length; i++) {
    var cell = plan.cells[i];
    var rect = layer.rect(cell.x, cell.y, cell.width, cell.height);
    rect.fill(cell.color);
    if (plan.stroke) rect.stroke(plan.stroke, plan.strokeThickness);
  }
  return layer;
};


/**
 * Convenience factory mirroring acgraph.create() style.
 * @param {!Object=} opt_config
 * @return {!acgraph.heatmap.Heatmap}
 */
acgraph.heatmap.create = function(opt_config) {
  return new acgraph.heatmap.Heatmap(opt_config);
};


if (typeof module !== 'undefined' && module.exports) {
  module.exports = acgraph.heatmap;
}
