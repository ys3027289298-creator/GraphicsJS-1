/**
 * acgraph.sparkline — renderer over the DOM-free core.
 *
 * Only consumes the public acgraph surface: acgraph.create(), stage.layer(),
 * layer.path()/rect()/circle(), shape.fill()/stroke(), stage.remove().
 * Nothing in the existing library is modified; the whole feature lives under
 * the acgraph.sparkline namespace and every graphic is owned by one private
 * stage per instance so dispose() can remove the DOM wholesale.
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(require('./sparkline-core.js'));
  } else {
    root.acgraphSparkline = factory(root.acgraphSparklineCore);
  }
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  var COLORS = {
    line: '#2a78d6',        // validated categorical blue (dataviz palette slot 1)
    lastPoint: '#e34948',   // validated red (slot 8)
    marker: '#2a78d6',
    axis: '#c9c7bf',        // recessive neutral, no text labels
    empty: '#73716a'        // empty-state ink, 4.76:1 contrast on #fcfcfb
  };

  function resolveContainer(container) {
    if (typeof container === 'string') {
      var el = document.getElementById(container);
      if (!el) core.validateContainer(container); // throws the canonical error
      return el;
    }
    core.validateContainer(container);
    return container;
  }

  /**
   * @param {Element|string} container DOM element or element id.
   * @param {Array<number|null>} data series values; null/undefined/NaN entries
   *   are skipped, null data itself means the empty state.
   * @param {Object=} options width, height, axis, markers, markerIndices,
   *   bands, yDomain, plus optional color overrides (lineColor, lastPointColor,
   *   axisColor, emptyColor).
   */
  function create(container, data, options) {
    return new Sparkline(container, data, options || {});
  }

  function Sparkline(container, data, options) {
    this.disposed_ = false;
    this.options_ = options || {};
    this.elementCount_ = 0;
    this.layout_ = null;
    this.stage_ = null;
    this.layer_ = null;
    this.container_ = resolveContainer(container);
    this.render_(data);
  }

  Sparkline.prototype.setData = function (data) {
    if (this.disposed_) {
      throw new core.SparklineError('SPARKLINE_BAD_OPTION',
        'instance has been disposed; create a new sparkline instead of setData()');
    }
    this.teardown_();
    this.render_(data);
    return this;
  };

  Sparkline.prototype.getLayout = function () {
    // Deep-enough copy so callers cannot mutate internal geometry.
    return JSON.parse(JSON.stringify(this.layout_));
  };

  Sparkline.prototype.getElementCount = function () {
    return this.elementCount_;
  };

  Sparkline.prototype.getStage = function () {
    return this.stage_;
  };

  Sparkline.prototype.dispose = function () {
    if (this.disposed_) return; // idempotent
    this.teardown_();
    this.disposed_ = true;
  };

  Sparkline.prototype.teardown_ = function () {
    if (this.stage_) {
      this.stage_.remove(); // removes the whole DOM subtree in one call
      this.stage_ = null;
      this.layer_ = null;
      this.elementCount_ = 0;
    }
  };

  Sparkline.prototype.color_ = function (optionName, fallback) {
    return this.options_[optionName] || fallback;
  };

  Sparkline.prototype.render_ = function (data) {
    var layout = core.computeLayout(data, this.options_);
    this.layout_ = layout;

    var stage = acgraph.create(this.container_, layout.width, layout.height);
    var layer = stage.layer();
    this.stage_ = stage;
    this.layer_ = layer;
    var count = 0;

    if (layout.empty) {
      this.renderEmpty_(layer, layout);
      this.elementCount_ = 2; // dashed baseline path + hollow circle
      return;
    }

    if (layout.axis) {
      this.renderAxis_(layer, layout);
      count++;
    }

    for (var b = 0; b < layout.bands.length; b++) {
      var band = layout.bands[b];
      layer.rect(band.x, band.y, band.width, band.height)
        .fill(band.fill, band.opacity)
        .stroke(null);
      count++;
    }

    if (layout.single) {
      // One centered marker, never a fabricated line segment.
      var p = layout.rendered[0];
      layer.circle(p.x, p.y, layout.markerRadius)
        .fill(this.color_('lineColor', COLORS.line))
        .stroke(null);
      count++;
      this.elementCount_ = count;
      return;
    }

    // Polyline through every rendered point.
    var linePath = layer.path();
    for (var i = 0; i < layout.rendered.length; i++) {
      var pt = layout.rendered[i];
      if (i === 0) linePath.moveTo(pt.x, pt.y);
      else linePath.lineTo(pt.x, pt.y);
    }
    linePath.stroke(this.color_('lineColor', COLORS.line), 1.25);
    linePath.fill(null);
    count++;

    // Marker dots (already thinned to >= 4px; last point pinned).
    for (var m = 0; m < layout.markers.length; m++) {
      var mk = layout.markers[m];
      var isLast = mk.index === this.layout_.inputLength - 1;
      var circle = layer.circle(mk.x, mk.y, layout.markerRadius);
      if (isLast) {
        circle.fill(this.color_('lastPointColor', COLORS.lastPoint))
          .stroke('#ffffff', 1); // 2px-surface ring effect at small radii
      } else {
        circle.fill(this.color_('markerColor', COLORS.marker))
          .stroke(null);
      }
      count++;
    }
    this.elementCount_ = count;
  };

  Sparkline.prototype.renderAxis_ = function (layer, layout) {
    // Minimal L-shaped baseline: no text, no ticks, no labels.
    var x = layout.plot.left - layout.axisInset;
    var yBottom = layout.plot.bottom + layout.axisInset;
    var yTop = layout.plot.top - layout.axisInset;
    var axisPath = layer.path();
    axisPath.moveTo(x, yTop).lineTo(x, yBottom).lineTo(layout.plot.right + layout.axisInset, yBottom);
    axisPath.stroke(this.color_('axisColor', COLORS.axis), 1).fill(null);
  };

  Sparkline.prototype.renderEmpty_ = function (layer, layout) {
    var g = layout.emptyGlyph;
    var dashed = layer.path();
    dashed.moveTo(g.baselineX1, g.baselineY).lineTo(g.baselineX2, g.baselineY);
    dashed.stroke({color: this.color_('emptyColor', COLORS.empty), dash: '3 2'}, 1);
    dashed.fill(null);
    // Hollow circle marks "no data" distinctly from a real single-point marker.
    layer.circle(g.circleCX, g.circleCY, g.circleR)
      .fill(null)
      .stroke(this.color_('emptyColor', COLORS.empty), 1);
  };

  var api = {
    create: create,
    Sparkline: Sparkline,
    SparklineError: core.SparklineError,
    COLORS: COLORS,
    core: core
  };

  // Attach to the acgraph namespace when it exists (browser), otherwise expose
  // the module standalone (Node tests use the core directly).
  if (typeof acgraph !== 'undefined') {
    acgraph.sparkline = api;
  }
  return api;
});
