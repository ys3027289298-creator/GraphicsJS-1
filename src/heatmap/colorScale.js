/**
 * @fileoverview Configurable color scale used by the heatmap to map normalized
 * domain values (always in [0, 1]) onto RGB colors. The normalization is pure
 * data-space logic and is intentionally decoupled from rendering, so the same
 * input produces the same color regardless of any subsequent zoom/resize.
 *
 * The module has no runtime dependencies (no goog.*, no DOM) and can be loaded
 * in Node.js directly for unit testing.
 *
 * @suppress {underscore}
 */

var globalScope = typeof globalThis !== 'undefined' ? globalThis :
    (typeof window !== 'undefined' ? window : this);
var acgraph = globalScope.acgraph = globalScope.acgraph || {};
acgraph.heatmap = acgraph.heatmap || {};


/**
 * Parses #rgb / #rrggbb / rgb(r,g,b) strings into an [r, g, b] array.
 * @param {string|!Array<number>} color
 * @return {!Array<number>}
 * @private
 */
acgraph.heatmap.parseColor_ = function(color) {
  if (Array.isArray(color)) {
    if (color.length < 3) throw new Error('Color array must contain at least 3 channels');
    return [color[0] & 255, color[1] & 255, color[2] & 255];
  }
  var str = String(color).trim().toLowerCase();
  var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(str);
  if (m) {
    var hex = m[1];
    if (hex.length === 3) hex = hex.split('').map(function(ch) { return ch + ch; }).join('');
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(str);
  if (m) return [parseInt(m[1], 10) & 255, parseInt(m[2], 10) & 255, parseInt(m[3], 10) & 255];
  throw new Error('Unsupported color format: ' + color);
};


/**
 * A piecewise-linear color scale built from ordered color stops.
 * Stops are normalized to offsets in [0, 1] and interpolated channel-wise.
 * @param {!Array<(string|!Array<number>|!{offset:(number|undefined),color:(string|!Array<number>)})>=} opt_stops
 * @constructor
 */
acgraph.heatmap.ColorScale = function(opt_stops) {
  /**
   * Ordered stops: [{offset:number, rgb:!Array<number>}].
   * @type {!Array<!{offset:number, rgb:!Array<number>}>}
   * @private
   */
  this.stops_ = [];
  this.setStops(opt_stops || [
    {offset: 0, color: '#08306b'},
    {offset: 0.5, color: '#f7fbff'},
    {offset: 1, color: '#7f0000'}
  ]);
};


/**
 * Replaces the stop list. Bare colors are spread evenly across [0, 1].
 * @param {!Array<(string|!Array<number>|!{offset:(number|undefined),color:(string|!Array<number>)})>} stops
 * @return {!acgraph.heatmap.ColorScale}
 */
acgraph.heatmap.ColorScale.prototype.setStops = function(stops) {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error('Color scale requires at least 2 color stops');
  }
  var explicit = stops.map(function(stop, index) {
    if (typeof stop === 'string' || Array.isArray(stop)) {
      return {offset: index / (stops.length - 1), rgb: acgraph.heatmap.parseColor_(stop)};
    }
    if (!stop || stop.color == null) throw new Error('Each color stop must define a color');
    return {
      offset: stop.offset == null ? index / (stops.length - 1) : Number(stop.offset),
      rgb: acgraph.heatmap.parseColor_(stop.color)
    };
  });
  explicit.forEach(function(stop) {
    if (!(stop.offset >= 0 && stop.offset <= 1)) throw new Error('Color stop offset must be within [0, 1]');
  });
  explicit.sort(function(a, b) { return a.offset - b.offset; });
  if (explicit[0].offset !== 0) explicit[0].offset = 0;
  if (explicit[explicit.length - 1].offset !== 1) explicit[explicit.length - 1].offset = 1;
  this.stops_ = explicit;
  return this;
};


/**
 * Maps a normalized value t in [0, 1] onto an [r, g, b] array. Values outside
 * the range are clamped so a misconfigured domain can never produce NaN colors.
 * @param {number} t
 * @return {!Array<number>}
 */
acgraph.heatmap.ColorScale.prototype.rgbAt = function(t) {
  if (!(t >= 0)) t = 0;
  if (t > 1) t = 1;
  var stops = this.stops_;
  for (var i = 0; i < stops.length - 1; i++) {
    var lo = stops[i];
    var hi = stops[i + 1];
    if (t <= hi.offset) {
      var span = hi.offset - lo.offset;
      var f = span === 0 ? 0 : (t - lo.offset) / span;
      return [
        Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f),
        Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f),
        Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f)
      ];
    }
  }
  return stops[stops.length - 1].rgb.slice();
};


/**
 * Convenience helper returning a css rgb() string.
 * @param {number} t
 * @return {string}
 */
acgraph.heatmap.ColorScale.prototype.colorAt = function(t) {
  var rgb = this.rgbAt(t);
  return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
};


/**
 * @return {!Array<!{offset:number, rgb:!Array<number>}>}
 */
acgraph.heatmap.ColorScale.prototype.getStops = function() {
  return this.stops_.map(function(stop) { return {offset: stop.offset, rgb: stop.rgb.slice()}; });
};


if (typeof module !== 'undefined' && module.exports) {
  module.exports = acgraph.heatmap.ColorScale;
}
