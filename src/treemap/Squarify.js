/**
 * @fileoverview Gap-aware squarified treemap tiling (Bruls, Huizing, van Wijk,
 * 2000). Items are sorted by descending weight, packed into rows along the
 * shortest edge of the remaining rectangle, and a row is fixed once adding the
 * next item would worsen its worst aspect ratio.
 */

'use strict';

/**
 * Worst aspect ratio of a row of items laid out inside a strip.
 * @param {number} stripLength Length of the fixed edge.
 * @param {number} rowWeight Total row weight.
 * @param {number} stripWeight Total weight of the strip (full area).
 * @param {Array.<number>} itemWeights
 * @return {number}
 */
function worstRatio(stripLength, rowWeight, stripWeight, itemWeights) {
  var stripBreadth = rowWeight / stripWeight * stripLength;
  var worst = 0;
  for (var i = 0; i < itemWeights.length; i++) {
    var itemBreadth = itemWeights[i] / rowWeight * stripBreadth;
    var ratio = Math.max(stripBreadth / itemBreadth, itemBreadth / stripBreadth);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/**
 * Splits a rectangle among weighted items with the squarified algorithm.
 * @param {Array.<{weight:number}>} items Positive-weight items, in render order.
 * @param {{x:number,y:number,width:number,height:number}} rect Available area.
 * @param {number} gap Gap between sibling rectangles, in pixels.
 * @return {Array.<{x:number,y:number,width:number,height:number}>} One rect per
 *     input item (same order).
 */
function squarify(items, rect, gap) {
  var ordered = items
    .map(function(item, index) { return {index: index, weight: item.weight}; })
    .sort(function(a, b) { return b.weight - a.weight; });
  var remainingWeight = ordered.reduce(function(sum, item) { return sum + item.weight; }, 0);
  var area = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    weight: remainingWeight
  };
  var placed = new Array(items.length);
  var cursor = 0;

  while (cursor < ordered.length) {
    var lastRow = ordered.length - 1;
    var horizontal = area.width >= area.height;
    var fixedEdge = horizontal ? area.height : area.width;
    var row = [];
    var rowIndices = [];
    while (cursor <= lastRow) {
      var candidate = row.concat([ordered[cursor].weight]);
      if (row.length === 0 ||
          worstRatio(fixedEdge, sum(candidate), area.weight, candidate) <=
          worstRatio(fixedEdge, sum(row), area.weight, row)) {
        row.push(ordered[cursor].weight);
        rowIndices.push(cursor);
        cursor++;
      } else {
        break;
      }
    }

    var rowWeight = sum(row);
    var stripBreadth = rowWeight / area.weight *
      (horizontal ? area.width : area.height);
    if (cursor > lastRow) {
      stripBreadth = horizontal ? area.width : area.height;
    }
    var offset = 0;
    for (var k = 0; k < row.length; k++) {
      var itemBreadth;
      var gapBudget = (row.length - 1) * gap;
      if (row.length === 1) {
        itemBreadth = fixedEdge;
      } else if (k === row.length - 1) {
        itemBreadth = fixedEdge - offset - gapBudget;
      } else {
        itemBreadth = row[k] / rowWeight * (stripBreadth - gapBudget);
      }
      if (itemBreadth < 0) itemBreadth = 0;
      var itemIndex = ordered[rowIndices[k]].index;
      if (horizontal) {
        placed[itemIndex] = {
          x: area.x,
          y: area.y + offset,
          width: stripBreadth,
          height: itemBreadth
        };
      } else {
        placed[itemIndex] = {
          x: area.x + offset,
          y: area.y,
          width: itemBreadth,
          height: stripBreadth
        };
      }
      offset += itemBreadth + gap;
    }

    if (horizontal) {
      area = {
        x: area.x + stripBreadth + gap,
        y: area.y,
        width: area.width - stripBreadth - gap,
        height: area.height,
        weight: area.weight - rowWeight
      };
    } else {
      area = {
        x: area.x,
        y: area.y + stripBreadth + gap,
        width: area.width,
        height: area.height - stripBreadth - gap,
        weight: area.weight - rowWeight
      };
    }
  }
  return placed;
}

function sum(values) {
  return values.reduce(function(total, value) { return total + value; }, 0);
}

module.exports = {squarify: squarify};
