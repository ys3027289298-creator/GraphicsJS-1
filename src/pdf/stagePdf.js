// Copyright (c) 2026 GraphicsJS PDF export contributors
// SPDX-License-Identifier: BSD-3-Clause

/**
 * @fileoverview Stage-level integration for the local (server-free) PDF
 * exporter. Every method here is additive: the legacy remote-server export
 * paths in src/exporting.js are untouched.
 *
 * Public surface (also exported on the acgraph namespace in browser builds):
 *   acgraph.pdf.registerFont(family, bytes)
 *   acgraph.pdf.setDefaultFonts(families)
 *   stage.toPdfDocument(options)      -> {bytes, warnings, diagnostics}
 *   stage.saveAsPdfLocal(options)     -> triggers a client-side download
 */
if (typeof goog !== 'undefined' && goog.provide) {
  goog.provide('acgraph.pdf.stagePdf');
  goog.require('acgraph.pdf.svg2pdf');
}

(function () {
  'use strict';


  // Browser/jsdom: a bare `acgraph` resolves on the window. Node: no such
  // global, so create one on the module's global object. This keeps a single
  // acgraph.pdf namespace across every module without referencing self/window,
  // which are not in scope inside jsdom's window.eval.
  var g;
  if (typeof acgraph !== 'undefined') {
    g = acgraph;
  } else if (typeof globalThis !== 'undefined') {
    g = globalThis.acgraph = globalThis.acgraph || {};
  } else {
    g = (this.acgraph = this.acgraph || {});
  }
  var pdfNs = g.pdf = g.pdf || {};

  var svg2pdf = pdfNs.svg2pdf ||
      (typeof require === 'function' ? require('./svg2pdf.js') : null);

  /**
   * Process-wide font registry plus a default fallback chain. The registry is
   * created lazily so headless tests can reset it.
   * @type {acgraph.pdf.svg2pdf.FontRegistry}
   * @private
   */
  var sharedRegistry_ = null;
  var defaultFamilies_ = [];

  function registry() {
    if (!sharedRegistry_) sharedRegistry_ = new svg2pdf.FontRegistry();
    return sharedRegistry_;
  }

  /**
   * Registers a TTF font under a family name. The same family may be
   * re-registered to replace its bytes. Registration order defines the
   * fallback chain used when a glyph is missing from the requested family.
   *
   * @param {string} family CSS-style family name (matched case-insensitively).
   * @param {Uint8Array} bytes Raw TTF bytes (CFF/OTF rejected explicitly).
   * @return {Object} The registered font descriptor.
   */
  function registerFont(family, bytes) {
    if (!family || typeof family !== 'string') {
      throw new svg2pdf.Svg2PdfError(svg2pdf.Code.E_FONT_FORMAT, 'font family name must be a non-empty string');
    }
    if (!(bytes && bytes.length)) {
      throw new svg2pdf.Svg2PdfError(svg2pdf.Code.E_FONT_TRUNCATED, 'font bytes are empty');
    }
    var entry = registry().register(family, bytes);
    if (defaultFamilies_.indexOf(entry.key) < 0) defaultFamilies_.push(entry.key);
    return entry;
  }

  /**
   * Overrides the fallback chain (family keys, case-insensitive).
   * @param {string[]} families
   */
  function setDefaultFonts(families) {
    defaultFamilies_ = (families || []).map(function (x) { return String(x).toLowerCase(); });
    var r = registry();
    r.chain = defaultFamilies_.filter(function (key) { return r.fonts[key]; });
  }

  /**
   * Builds a PDF document from the current stage without contacting any
   * export server. The SVG serialization path is the same one the legacy
   * exporters use, so visual input is identical.
   *
   * @param {Object=} opt_options
   *   width, height: page size in PDF points (default: stage viewport at dpi)
   *   dpi: user-unit resolution used when width/height are omitted (72)
   *   compress: whether to Flate-compress streams (default true)
   *   title: document title metadata
   *   fontFamily: override every text element's family
   * @return {{bytes:Uint8Array, warnings:Array, diagnostics:Object,
   *           extractedText:Array<string>, sourceText:Array<string>}}
   */
  function stageToPdfDocument(stage, opt_options) {
    if (typeof acgraph === 'undefined' || !acgraph.vector || acgraph.type() !== acgraph.StageType.SVG) {
      throw new svg2pdf.Svg2PdfError('E_STAGE_NOT_SVG',
          'local PDF export requires an SVG stage; VML stages are not supported');
    }
    var options = opt_options || {};
    var svgText = stage.toSvg();
    if (options.fontFamily) {
      svgText = svgText.replace(/font-family\s*:\s*[^;";]+/gi,
          'font-family: ' + options.fontFamily);
    }
    return svg2pdf.convert(svgText, options, registry());
  }

  /**
   * Browser-only convenience: render and trigger a file download.
   * @param {Object=} opt_options Same options as stageToPdfDocument plus
   *   `filename` (default "acgraph-export.pdf").
   * @return {{bytes:Uint8Array, warnings:Array, diagnostics:Object}}
   */
  function stageSaveAsPdfLocal(stage, opt_options) {
    var options = opt_options || {};
    var result = stageToPdfDocument(stage, options);
    if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
      // Headless environment: return the bytes, do not attempt a download.
      return result;
    }
    var blob = new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = options.filename || 'acgraph-export.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return result;
  }

  pdfNs.registerFont = registerFont;
  pdfNs.setDefaultFonts = setDefaultFonts;
  pdfNs._registry = registry;
  pdfNs.convertSvg = function (svgText, options) {
    return svg2pdf.convert(svgText, options || {}, registry());
  };

  // Attach Stage methods only when the acgraph stage prototype exists.
  if (typeof acgraph !== 'undefined' && acgraph.vector && acgraph.vector.Stage) {
    var proto = acgraph.vector.Stage.prototype;
    proto.toPdfDocument = function (opt_options) {
      return stageToPdfDocument(this, opt_options);
    };
    proto.saveAsPdfLocal = function (opt_options) {
      return stageSaveAsPdfLocal(this, opt_options);
    };
    if (proto.exportSymbol) {
      proto.exportSymbol('toPdfDocument', proto.toPdfDocument);
      proto.exportSymbol('saveAsPdfLocal', proto.saveAsPdfLocal);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      registerFont: registerFont,
      setDefaultFonts: setDefaultFonts,
      convertSvg: pdfNs.convertSvg,
      registry: registry
    };
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
