/**
 * @fileoverview Deterministic, DOM-free text measurement and the label
 * fitting pipeline: shrink font size, then word wrap, then ellipsize,
 * then drop. A dropped label is the only possible outcome when text does
 * not fit, so labels can never overflow their rectangle.
 */

'use strict';

var LINE_HEIGHT_FACTOR = 1.2;
var TEXT_PADDING_X = 4;
var TEXT_PADDING_Y = 2;

/**
 * Average glyph advance width as a fraction of font size. Keyed by the
 * first character class; deliberately coarse but fully deterministic so
 * Node and every browser compute identical layouts.
 * @const {Object.<string, number>}
 */
var CHAR_WIDTH_FACTOR = {
  space: 0.3,
  upper: 0.7,
  digit: 0.56,
  narrow: 0.3,
  wide: 0.85,
  mid: 0.38,
  normal: 0.55,
  punctuation: 0.45
};

/**
 * @param {string} ch
 * @return {string}
 */
function charClass(ch) {
  if (ch === ' ') return 'space';
  if (ch >= 'A' && ch <= 'Z') return 'upper';
  if (ch >= '0' && ch <= '9') return 'digit';
  if (ch === 'i' || ch === 'l' || ch === 'j') return 'narrow';
  if (ch === 'm' || ch === 'w') return 'wide';
  if (ch === 'f' || ch === 'r' || ch === 't') return 'mid';
  if ((ch >= 'a' && ch <= 'z')) return 'normal';
  return 'punctuation';
}

/**
 * Measures a single-line string at a given font size.
 * @param {string} text
 * @param {number} fontSize
 * @return {number}
 */
function measureText(text, fontSize) {
  var width = 0;
  for (var i = 0; i < text.length; i++) {
    width += CHAR_WIDTH_FACTOR[charClass(text.charAt(i))] * fontSize;
  }
  return width;
}

/**
 * Greedy word wrap. Words never break in this stage.
 * @param {string} text
 * @param {number} fontSize
 * @param {number} maxWidth
 * @return {Array.<string>}
 */
function wrapWords(text, fontSize, maxWidth) {
  var words = text.split(' ');
  var lines = [];
  var current = '';
  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    var candidate = current ? current + ' ' + word : word;
    if (measureText(candidate, fontSize) <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Ellipsizing layout used once no font size can fit the full text. Words
 * may be clipped mid-word; the clipped token gets a trailing ellipsis.
 * Returns null when not even one clipped line fits.
 * @param {string} text
 * @param {number} fontSize
 * @param {number} maxWidth
 * @param {number} maxLines
 * @return {{lines: Array.<string>, ellipsized: boolean}?}
 */
function wrapWithEllipsis(text, fontSize, maxWidth, maxLines) {
  var ellipsis = '…';
  var ellipsisWidth = measureText(ellipsis, fontSize);
  if (ellipsisWidth > maxWidth || maxLines < 1) return null;

  var words = text.split(' ');
  var lines = [];
  var current = '';
  var ellipsized = false;

  function clipWord(word) {
    var clipped = '';
    for (var k = 0; k < word.length; k++) {
      if (measureText(clipped + word.charAt(k) + ellipsis, fontSize) <= maxWidth) {
        clipped += word.charAt(k);
      } else {
        break;
      }
    }
    return clipped ? clipped + ellipsis : null;
  }

  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    var candidate = current ? current + ' ' + word : word;
    if (measureText(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      var clippedLine = current ? current + ' ' + ellipsis : clipWord(word);
      if (clippedLine && measureText(clippedLine, fontSize) <= maxWidth) {
        current = clippedLine;
        ellipsized = true;
        break;
      }
      if (!current) {
        current = clipWord(word);
        if (!current) return null;
        ellipsized = true;
        break;
      }
      current = current + ellipsis;
      ellipsized = true;
      break;
    }
    if (current) lines.push(current);
    if (measureText(word, fontSize) <= maxWidth) {
      current = word;
    } else {
      current = clipWord(word);
      if (!current) return null;
      ellipsized = true;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) return null;
  return {lines: lines, ellipsized: ellipsized};
}

/**
 * Fits a label inside a rectangle.
 * @param {string} text
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {{minFontSize:number,maxFontSize:number,fontStep:number,fontFamily:string}} options
 * @return {{fontSize:number,lines:Array.<string>,ellipsized:boolean,dropped:boolean,
 *           lineHeight:number,textPadding:number}|null} null means the label
 *           is dropped, which never overflows.
 */
function fitLabel(text, rect, options) {
  if (!text || !rect || rect.width <= 2 * TEXT_PADDING_X ||
      rect.height <= 2 * TEXT_PADDING_Y) {
    return null;
  }
  var maxWidth = rect.width - 2 * TEXT_PADDING_X;
  var maxHeight = rect.height - 2 * TEXT_PADDING_Y;

  var step = options.fontStep || 1;
  for (var size = options.maxFontSize; size >= options.minFontSize; size -= step) {
    var lineHeight = size * LINE_HEIGHT_FACTOR;
    var lines = wrapWords(text, size, maxWidth);
    if (lines.length * lineHeight <= maxHeight &&
        lines.every(function(line) { return measureText(line, size) <= maxWidth; })) {
      return {
        fontSize: size,
        lines: lines,
        ellipsized: false,
        dropped: false,
        lineHeight: lineHeight,
        textPadding: TEXT_PADDING_X
      };
    }
  }

  var minSize = options.minFontSize;
  var minLineHeight = minSize * LINE_HEIGHT_FACTOR;
  var maxLines = Math.max(1, Math.floor(maxHeight / minLineHeight));
  var clipped = wrapWithEllipsis(text, minSize, maxWidth, maxLines);
  if (!clipped) return null;
  return {
    fontSize: minSize,
    lines: clipped.lines,
    ellipsized: clipped.ellipsized,
    dropped: false,
    lineHeight: minLineHeight,
    textPadding: TEXT_PADDING_X
  };
}

module.exports = {
  LINE_HEIGHT_FACTOR: LINE_HEIGHT_FACTOR,
  TEXT_PADDING_X: TEXT_PADDING_X,
  TEXT_PADDING_Y: TEXT_PADDING_Y,
  measureText: measureText,
  fitLabel: fitLabel
};
