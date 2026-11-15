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
