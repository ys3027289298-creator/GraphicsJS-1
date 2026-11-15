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

  var TreemapModule = require('./Treemap');
  var Renderer = require('./Renderer');
  var ErrorModule = require('./error');

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
