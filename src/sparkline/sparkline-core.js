/**
 * acgraph.sparkline — pure geometry / validation core.
 *
 * This file is DOM-free: it validates input and turns a data series into a
 * deterministic layout snapshot (plot box, domain, decimated points, marker
 * subset, band rectangles and the empty/single-point glyph descriptors). The
 * renderer (sparkline.js) consumes exactly this snapshot, and the Node-side
 * tests require() the same file, so geometry can never drift between tests and
 * what is painted.
 *
 * UMD wrapper: works as a Closure-style browser global (window.acgraphSparklineCore)
 * and as a CommonJS module in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.acgraphSparklineCore = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -- Tunables (all geometry guarantees derive from these) ------------------
  var PADDING = 2;              // px of breathing room on every side
  var MIN_POINT_SPACING = 2;    // px, hard lower bound between adjacent points
  var MIN_MARKER_SPACING = 4;   // px, second-pass thinning for marker dots
  var DEFAULT_HEIGHT = 16;
  var DEFAULT_WIDTH = 40;
  var MARKER_R_MIN = 1.5;
  var MARKER_R_FRACTION = 1 / 8; // radius = min(width, height) / 8, clamped to the floor
  var AXIS_INSET = 1;            // L-axis sits 1px inside the padding line

  // -- Error type ------------------------------------------------------------
  function SparklineError(code, message) {
    this.name = 'SparklineError';
    this.code = code;
    this.message = message || code;
    if (Error.captureStackTrace) Error.captureStackTrace(this, SparklineError);
  }
  SparklineError.prototype = Object.create(Error.prototype);
  SparklineError.prototype.constructor = SparklineError;

  function fail(code, message) {
    throw new SparklineError(code, message);
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function isPlainContainer(v) {
    // DOM-side check is injected by the renderer; the core itself never sees
    // the DOM. A non-null object with nodeType 1 is accepted as an element.
    return !!v && typeof v === 'object' && v.nodeType === 1;
  }

  // -- Validation ------------------------------------------------------------
  function validateContainer(container) {
    if (container == null) {
      fail('SPARKLINE_BAD_CONTAINER',
        'container must be a DOM element or an existing element id');
    }
    if (typeof container === 'string') {
      if (typeof document === 'undefined' || !document.getElementById(container)) {
        fail('SPARKLINE_BAD_CONTAINER',
          'container must be a DOM element or an existing element id');
      }
    } else if (!isPlainContainer(container)) {
      fail('SPARKLINE_BAD_CONTAINER',
        'container must be a DOM element or an existing element id');
    }
  }

  /**
   * Normalizes the raw data argument.
   *  - null/undefined -> [] (empty state, not an error)
   *  - array -> copy with null/undefined/NaN entries dropped
   *  - anything else -> SPARKLINE_BAD_DATA
   * Throws SPARKLINE_BAD_DATUM for entries that are present but non-finite.
   */
  function normalizeData(data) {
    if (data == null) return [];
    if (typeof data !== 'object' || Object.prototype.toString.call(data) !== '[object Array]') {
      fail('SPARKLINE_BAD_DATA', 'data must be an array of finite numbers');
    }
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      if (v == null || (typeof v === 'number' && isNaN(v))) continue; // sparse tolerance
      if (!isFiniteNumber(v)) {
        fail('SPARKLINE_BAD_DATUM',
          'data[' + i + '] is not a finite number (got ' + String(v) + ')');
      }
      out.push({index: i, value: v});
    }
    return out;
  }

  function validatePositiveSize(name, value) {
    if (!isFiniteNumber(value) || value <= 0) {
      fail('SPARKLINE_BAD_OPTION', name + ' must be a positive number, got ' + String(value));
    }
  }

  function validateOptions(options, dataLength) {
    var o = options || {};
    var width = o.width == null ? DEFAULT_WIDTH : o.width;
    var height = o.height == null ? DEFAULT_HEIGHT : o.height;
    validatePositiveSize('width', width);
    validatePositiveSize('height', height);

    var markerIndices = o.markerIndices;
    if (markerIndices != null) {
      if (Object.prototype.toString.call(markerIndices) !== '[object Array]') {
        fail('SPARKLINE_BAD_MARKER', 'markerIndices must be an array of integer indices');
      }
      for (var i = 0; i < markerIndices.length; i++) {
        var mi = markerIndices[i];
        if (typeof mi !== 'number' || !isInteger(mi)) {
          fail('SPARKLINE_BAD_MARKER',
            'markerIndices[' + i + '] must be an integer index, got ' + String(mi));
        }
        if (mi < 0 || mi >= dataLength) {
          fail('SPARKLINE_BAD_MARKER',
            'markerIndices[' + i + '] out of range: must be an integer index in [0,' +
            (dataLength - 1) + '], got ' + mi);
        }
      }
    }

    var bands = o.bands;
    if (bands != null) {
      if (Object.prototype.toString.call(bands) !== '[object Array]') {
        fail('SPARKLINE_BAD_BAND', 'bands must be an array of {from, to} band specs');
      }
      for (var b = 0; b < bands.length; b++) {
        var band = bands[b];
        if (!band || !isFiniteNumber(band.from) || !isFiniteNumber(band.to) ||
          !isInteger(band.from) || !isInteger(band.to)) {
          fail('SPARKLINE_BAD_BAND',
            'bands[' + b + '] must have integer from/to values');
        }
        if (band.from < 0 || band.to < band.from || band.to >= dataLength) {
          fail('SPARKLINE_BAD_BAND',
            'bands[' + b + '] invalid: require 0 <= from <= to < data.length (' +
            dataLength + '), got from=' + band.from + ', to=' + band.to);
        }
      }
    }

    var yDomain = o.yDomain;
    if (yDomain != null) {
      if (Object.prototype.toString.call(yDomain) !== '[object Array]' || yDomain.length !== 2 ||
        !isFiniteNumber(yDomain[0]) || !isFiniteNumber(yDomain[1]) ||
        yDomain[0] >= yDomain[1]) {
        fail('SPARKLINE_BAD_OPTION',
          'yDomain must be [min, max] with min < max, both finite');
      }
    }
    return o;
  }

  function isInteger(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  // -- Domain ----------------------------------------------------------------
  function computeDomain(points, fixedDomain) {
    if (fixedDomain) return {min: fixedDomain[0], max: fixedDomain[1], synthesized: false};
    var min = Infinity, max = -Infinity, sum = 0;
    for (var i = 0; i < points.length; i++) {
      var v = points[i].value;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    if (min === max) {
      // Constant series: synthesize a symmetric domain so the line renders as
      // a centered horizontal segment instead of collapsing to a pixel row.
      var center = min;
      var half = min === 0 ? 1 : Math.abs(min);
      return {min: center - half, max: center + half, synthesized: true};
    }
    return {min: min, max: max, synthesized: false};
  }

  // -- Slot decimation -------------------------------------------------------
  /**
   * Guarantees adjacent rendered x positions are >= MIN_POINT_SPACING px.
   * When n fits the capacity every point survives on its true x position.
   * Otherwise points are mapped to fixed slots of width MIN_POINT_SPACING and
   * each occupied slot keeps the sample with the largest absolute deviation
   * from the series mean (earliest index wins ties). First/last samples and
   * markerIndices pins are never evicted.
   */
  function decimate(points, capacity, pinned) {
    var n = points.length;
    if (n <= capacity) {
      return points.map(function (p) {
        return {index: p.index, value: p.value, slot: null};
      });
    }
    var sum = 0;
    for (var i = 0; i < n; i++) sum += points[i].value;
    var mean = sum / n;

    var slots = new Array(capacity);
    var slotOf = new Array(n);
    function put(slotIndex, pointIndex, isPin) {
      var p = points[pointIndex];
      var existing = slots[slotIndex];
      slotOf[pointIndex] = slotIndex;
      if (!existing) {
        slots[slotIndex] = {index: p.index, value: p.value, slot: slotIndex};
        return;
      }
      if (isPin) return; // a pin keeps its slot; the non-pin loses its claim
      var incoming = Math.abs(p.value - mean);
      var current = Math.abs(existing.value - mean);
      // Strictly greater deviation replaces; ties keep the earlier index.
      if (incoming > current) {
        slots[slotIndex] = {index: p.index, value: p.value, slot: slotIndex};
      }
    }

    // Hard pins first so ordinary samples can never steal their slot.
    for (var pi = 0; pi < pinned.length; pi++) {
      var pinIndex = pinned[pi];
      var pinSlot = slotFor(pinIndex, n, capacity);
      put(pinSlot, pinIndex, true);
    }
    // First and last are always pins.
    var firstSlot = slotFor(0, n, capacity);
    var lastSlot = slotFor(n - 1, n, capacity);
    if (slots[firstSlot] == null || slots[firstSlot].index !== 0) {
      slots[firstSlot] = {index: points[0].index, value: points[0].value, slot: firstSlot};
    }
    if (slots[lastSlot] == null || slots[lastSlot].index !== n - 1) {
      slots[lastSlot] = {index: points[n - 1].index, value: points[n - 1].value, slot: lastSlot};
    }

    for (var k = 1; k < n - 1; k++) {
      if (pinned.indexOf(k) !== -1) continue;
      put(slotFor(k, n, capacity), k, false);
    }

    var out = [];
    for (var s = 0; s < capacity; s++) {
      if (slots[s]) out.push(slots[s]);
    }
    // Restore original index order (slots are already ascending, but be explicit).
    out.sort(function (a, b) { return a.index - b.index; });
    return out;
  }

  function slotFor(i, n, capacity) {
    if (n === 1) return 0;
    return Math.floor(i * (capacity - 1) / (n - 1));
  }

  /**
   * Second thinning pass for marker dots. Pinned markers (markerIndices and
   * the last point) always survive; ordinary markers survive only while they
   * stay MIN_MARKER_SPACING px from the previously accepted marker.
   */
  function thinMarkers(rendered, xOf, pinnedIndices) {
    var kept = [];
    var lastKeptX = -Infinity;
    for (var i = 0; i < rendered.length; i++) {
      var p = rendered[i];
      var pinned = pinnedIndices.indexOf(p.index) !== -1;
      var x = xOf(p);
      if (pinned || x - lastKeptX >= MIN_MARKER_SPACING) {
        kept.push(p);
        lastKeptX = x;
      }
    }
    return kept;
  }

  // -- Layout (the one source of truth for renderer and tests) ---------------
  function computeLayout(data, options) {
    var normalized = normalizeData(data);
    var o = validateOptions(options, normalized.length);
    var width = o.width == null ? DEFAULT_WIDTH : o.width;
    var height = o.height == null ? DEFAULT_HEIGHT : o.height;

    var markerRadius = Math.max(MARKER_R_MIN,
      Math.min(width, height) * MARKER_R_FRACTION);
    var plotLeft = PADDING + markerRadius;
    var plotRight = width - PADDING - markerRadius;
    var plotTop = PADDING + markerRadius;
    var plotBottom = height - PADDING - markerRadius;
    var plotWidth = Math.max(0, plotRight - plotLeft);
    var plotHeight = Math.max(0, plotBottom - plotTop);

    var capacity = Math.floor(plotWidth / MIN_POINT_SPACING) + 1;

    var layout = {
      width: width,
      height: height,
      padding: PADDING,
      markerRadius: markerRadius,
      plot: {left: plotLeft, right: plotRight, top: plotTop, bottom: plotBottom,
        width: plotWidth, height: plotHeight},
      capacity: capacity,
      minPointSpacing: MIN_POINT_SPACING,
      minMarkerSpacing: MIN_MARKER_SPACING,
      axis: o.axis !== false,
      axisInset: AXIS_INSET,
      empty: normalized.length === 0,
      single: normalized.length === 1,
      inputLength: normalized.length,
      domain: null,
      decimated: false,
      rendered: [],
      markers: [],
      bands: [],
      xOf: null
    };

    if (layout.empty) {
      // Empty glyph: dashed mid baseline + hollow circle, described geometrically.
      layout.emptyGlyph = {
        baselineY: (plotTop + plotBottom) / 2,
        baselineX1: plotLeft,
        baselineX2: plotRight,
        circleCX: (plotLeft + plotRight) / 2,
        circleCY: (plotTop + plotBottom) / 2,
        circleR: markerRadius
      };
      return layout;
    }

    layout.domain = computeDomain(normalized, o.yDomain);

    if (layout.single) {
      var only = normalized[0];
      layout.rendered = [{index: only.index, value: only.value, slot: null,
        x: (plotLeft + plotRight) / 2, y: (plotTop + plotBottom) / 2}];
      layout.markers = layout.rendered.slice();
      return layout;
    }

    var pins = [0, normalized.length - 1];
    if (o.markerIndices) {
      for (var mi = 0; mi < o.markerIndices.length; mi++) {
        if (pins.indexOf(o.markerIndices[mi]) === -1) pins.push(o.markerIndices[mi]);
      }
    }

    var rendered = decimate(normalized, capacity, pins);
    layout.decimated = rendered.length < normalized.length;

    var n = normalized.length;
    var domainSpan = layout.domain.max - layout.domain.min;
    function xOf(p) {
      if (p.slot != null) {
        return plotLeft + p.slot * MIN_POINT_SPACING;
      }
      if (n === 1) return (plotLeft + plotRight) / 2;
      return plotLeft + (p.index / (n - 1)) * plotWidth;
    }
    function yOf(value) {
      return plotBottom - ((value - layout.domain.min) / domainSpan) * plotHeight;
    }
    layout.xOf = xOf;

    layout.rendered = rendered.map(function (p) {
      return {index: p.index, value: p.value, slot: p.slot,
        x: xOf(p), y: yOf(p.value)};
    });

    // Markers: last point always; markerIndices pins always; "all" mode adds
    // every rendered point before the 4px thinning pass.
    var markerPins = [n - 1];
    if (o.markerIndices) {
      for (var m = 0; m < o.markerIndices.length; m++) {
        if (markerPins.indexOf(o.markerIndices[m]) === -1) markerPins.push(o.markerIndices[m]);
      }
    }
    var markerCandidates;
    if (o.markers === true) {
      markerCandidates = layout.rendered.slice();
    } else {
      markerCandidates = layout.rendered.filter(function (p) {
        return markerPins.indexOf(p.index) !== -1;
      });
    }
    var thinned = thinMarkers(markerCandidates, function (p) { return p.x; }, markerPins);
    layout.markers = thinned;
    layout.markerPins = markerPins;

    // Bands map original indices to rendered x coordinates. When decimation
    // removed the boundary sample, the band uses the slot x the boundary
    // would have occupied, so the rectangle still aligns with the grid.
    if (o.bands) {
      layout.bands = o.bands.map(function (band) {
        var fromSlot = slotFor(band.from, n, capacity);
        var toSlot = slotFor(band.to, n, capacity);
        var x1 = layout.decimated
          ? plotLeft + fromSlot * MIN_POINT_SPACING
          : plotLeft + (band.from / (n - 1)) * plotWidth;
        var x2 = layout.decimated
          ? plotLeft + (toSlot + 1) * MIN_POINT_SPACING
          : plotLeft + (band.to / (n - 1)) * plotWidth + MIN_POINT_SPACING / 2;
        // Clamp to the plot box so a band ending at the last sample never
        // spills into the marker safety padding.
        if (x2 > plotRight) x2 = plotRight;
        return {
          from: band.from,
          to: band.to,
          x: x1,
          y: plotTop,
          width: Math.max(0, x2 - x1),
          height: plotHeight,
          fill: band.fill || '#2a78d6',
          opacity: band.opacity == null ? 0.14 : band.opacity
        };
      });
    }

    return layout;
  }

  return {
    SparklineError: SparklineError,
    PADDING: PADDING,
    MIN_POINT_SPACING: MIN_POINT_SPACING,
    MIN_MARKER_SPACING: MIN_MARKER_SPACING,
    validateContainer: validateContainer,
    normalizeData: normalizeData,
    validateOptions: validateOptions,
    computeDomain: computeDomain,
    decimate: decimate,
    thinMarkers: thinMarkers,
    computeLayout: computeLayout,
    slotFor: slotFor
  };
});
