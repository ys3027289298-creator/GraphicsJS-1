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
