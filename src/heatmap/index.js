/**
 * @fileoverview CommonJS entry for the heatmap modules. In the browser the
 * three source files attach everything to the global acgraph.heatmap
 * namespace on their own; this file only exists so Node.js tooling can
 * require the whole package in one call.
 */
'use strict';

require('./colorScale.js');
require('./grid.js');
module.exports = require('./renderer.js');
